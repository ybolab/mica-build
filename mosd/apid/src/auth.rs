//! Password hashing/verification and login brute-force backoff.

use std::time::{Duration, Instant};

use argon2::Argon2;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};

const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(30);

/// Hash `password` with argon2id default parameters into a PHC string.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| anyhow::anyhow!("hash password: {err}"))
}

/// True when `password` matches the PHC-formatted `hash`.
pub fn verify_password(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash)
        .and_then(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed))
        .is_ok()
}

/// Global (not per-client) login backoff: after [`MAX_FAILURES`] consecutive
/// failed logins, every login attempt is rejected for [`LOCKOUT`]. A single
/// shared counter is deliberate — the appliance has one admin password, so
/// per-client tracking buys nothing against an online guesser.
#[derive(Default)]
pub struct LoginGuard {
    failures: u32,
    locked_until: Option<Instant>,
}

impl LoginGuard {
    /// True when a login attempt may proceed; expired lockouts are cleared.
    pub fn check(&mut self) -> bool {
        match self.locked_until {
            Some(until) if until > Instant::now() => false,
            Some(_) => {
                self.locked_until = None;
                self.failures = 0;
                true
            }
            None => true,
        }
    }

    /// Record a failed login, arming the lockout on the fifth in a row.
    pub fn record_failure(&mut self) {
        self.failures += 1;
        if self.failures >= MAX_FAILURES {
            self.locked_until = Some(Instant::now() + LOCKOUT);
        }
    }

    /// Record a successful login, resetting the failure counter.
    pub fn record_success(&mut self) {
        self.failures = 0;
        self.locked_until = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_roundtrip() {
        let hash = hash_password("correct horse").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password(&hash, "correct horse"));
        assert!(!verify_password(&hash, "wrong"));
        assert!(!verify_password("not a phc string", "wrong"));
    }

    #[test]
    fn guard_locks_after_five_failures() {
        let mut guard = LoginGuard::default();
        for _ in 0..4 {
            assert!(guard.check());
            guard.record_failure();
        }
        assert!(guard.check());
        guard.record_failure();
        assert!(!guard.check());

        let mut guard = LoginGuard::default();
        for _ in 0..4 {
            guard.record_failure();
        }
        guard.record_success();
        guard.record_failure();
        assert!(guard.check());
    }
}
