//! Minimal HTTP/1.1 transport for the device-side update client.
//!
//! Deliberately not a general HTTP client: `GET` only, plain `http` only,
//! `Connection: close`, no redirects, no TLS, no chunked responses, no
//! keep-alive. The repository this fetches from is static files behind any
//! web server, and every byte fetched is verified against signed TUF metadata
//! afterwards — integrity and authenticity come from the metadata walk, not
//! from the transport, which is exactly TUF's threat model (a hostile mirror
//! yields a refusal, not a compromise). What plain HTTP does not provide is
//! confidentiality: a deployment that needs it terminates TLS at a local
//! proxy or syncs the repository out of band and points the client at the
//! directory. Growing a TLS stack here is a deliberate-dependency decision,
//! not an oversight; the README records it.
//!
//! Every network operation is individually bounded by [`IO_TIMEOUT`], so a
//! stalled mirror fails the command instead of hanging it. A byte-range
//! request (`Range: bytes=<n>-`) is how a partial download resumes; a server
//! that ignores ranges answers 200 and the caller restarts from zero.

use std::future::Future;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail, ensure};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use url::Url;

/// Bound on every individual network operation (connect, one read, one write).
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Bound on the response head: status line plus headers.
const MAX_HEADER_BYTES: usize = 16 * 1024;

async fn timed<T>(what: &str, fut: impl Future<Output = std::io::Result<T>>) -> Result<T> {
    tokio::time::timeout(IO_TIMEOUT, fut)
        .await
        .map_err(|_| anyhow!("{what} took longer than {}s", IO_TIMEOUT.as_secs()))?
        .with_context(|| what.to_string())
}

/// One HTTP response: parsed head, body still on the wire.
pub struct Response {
    /// Status code from the status line.
    pub status: u16,
    /// `Content-Length`, when the server sent one.
    pub content_length: Option<u64>,
    /// Start offset of a `206` response's `Content-Range`, when present.
    pub range_start: Option<u64>,
    reader: BufReader<TcpStream>,
}

impl Response {
    /// Reads some body bytes into `buf`; `Ok(0)` is end of body (the server
    /// closes the connection — every request here sends `Connection: close`).
    pub async fn read_body(&mut self, buf: &mut [u8]) -> Result<usize> {
        timed("read response body", self.reader.read(buf)).await
    }

    /// Reads the whole body, refusing one longer than `cap` bytes.
    pub async fn body_capped(mut self, cap: u64, what: &str) -> Result<Vec<u8>> {
        let mut body = Vec::new();
        let mut buf = [0u8; 8 * 1024];
        loop {
            let n = self.read_body(&mut buf).await?;
            if n == 0 {
                return Ok(body);
            }
            ensure!(
                (body.len() + n) as u64 <= cap,
                "{what} is longer than the {cap}-byte cap this client holds for it; \
                 refusing to buffer an unbounded response"
            );
            body.extend_from_slice(&buf[..n]);
        }
    }
}

/// Issues one `GET`, optionally with a `Range: bytes=<start>-` header, and
/// parses the response head. The body is read from the returned [`Response`].
pub async fn get(url: &Url, range_start: Option<u64>) -> Result<Response> {
    ensure!(
        url.scheme() == "http",
        "{url} is not an http:// URL; this client speaks plain HTTP only \
         (verification is the metadata's job — terminate TLS at a proxy or \
         sync the repository to a local directory instead)"
    );
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("{url} names no host"))?;
    let port = url.port_or_known_default().unwrap_or(80);
    let stream = timed(
        &format!("connect to {host}:{port}"),
        TcpStream::connect((host, port)),
    )
    .await?;

    let host_header = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path = format!("{path}?{query}");
    }
    let mut request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\nUser-Agent: rauc-update\r\n"
    );
    if let Some(start) = range_start {
        request.push_str(&format!("Range: bytes={start}-\r\n"));
    }
    request.push_str("\r\n");

    let mut reader = BufReader::new(stream);
    timed(
        &format!("send request to {url}"),
        reader.get_mut().write_all(request.as_bytes()),
    )
    .await?;

    let status_line = read_head_line(&mut reader, url).await?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| anyhow!("{url} answered a malformed status line {status_line:?}"))?;

    let mut content_length = None;
    let mut range_start_seen = None;
    let mut head_bytes = status_line.len();
    loop {
        let line = read_head_line(&mut reader, url).await?;
        head_bytes += line.len() + 2;
        ensure!(
            head_bytes <= MAX_HEADER_BYTES,
            "{url} sent more than {MAX_HEADER_BYTES} bytes of response headers"
        );
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            bail!("{url} sent a malformed header line {line:?}");
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "content-length" => {
                content_length = Some(value.parse::<u64>().with_context(|| {
                    format!("{url} sent a non-numeric Content-Length {value:?}")
                })?);
            }
            // "bytes <start>-<end>/<total>"
            "content-range" => {
                range_start_seen = value
                    .strip_prefix("bytes ")
                    .and_then(|rest| rest.split('-').next())
                    .and_then(|start| start.parse::<u64>().ok());
            }
            "transfer-encoding" => {
                bail!(
                    "{url} answered with Transfer-Encoding {value:?}; this client reads \
                     Content-Length-framed bodies only"
                );
            }
            _ => {}
        }
    }

    Ok(Response {
        status,
        content_length,
        range_start: range_start_seen,
        reader,
    })
}

/// Reads one CRLF-terminated head line, without its terminator. The read is
/// capped at [`MAX_HEADER_BYTES`], so a head line that never ends cannot grow
/// an unbounded buffer; the truncated line then fails the caller's parse.
async fn read_head_line(reader: &mut BufReader<TcpStream>, url: &Url) -> Result<String> {
    let mut line = String::new();
    let mut limited = (&mut *reader).take(MAX_HEADER_BYTES as u64);
    let n = timed("read response headers", limited.read_line(&mut line)).await?;
    ensure!(
        n > 0,
        "{url} closed the connection before the response head ended"
    );
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}
