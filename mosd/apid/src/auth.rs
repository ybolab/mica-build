//! Password hashing/verification and login brute-force backoff.

use std::time::{Duration, Instant};

use argon2::Argon2;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};

/// `docs/design/access.md` §3.3's `backoffBase`. The first failure costs a
/// second; every consecutive one doubles it.
const BACKOFF_BASE: Duration = Duration::from_secs(1);
/// §3.3's `backoffMax`. The curve stops here and never becomes permanent —
/// see [`LoginGuard`] for why apid does not arm §3.3's `lockoutThreshold`.
const BACKOFF_MAX: Duration = Duration::from_secs(300);

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

/// The backoff a run of `failures` consecutive failures has earned:
/// `BACKOFF_BASE * 2^(failures - 1)`, capped at [`BACKOFF_MAX`].
///
/// Pure and total, so the curve is testable without a clock: the shift
/// saturates rather than overflowing, and the cap makes every count past the
/// ninth the same answer anyway.
fn backoff_for(failures: u32) -> Duration {
    if failures == 0 {
        return Duration::ZERO;
    }
    let factor = 1u64.checked_shl(failures - 1).unwrap_or(u64::MAX);
    let secs = BACKOFF_BASE.as_secs().saturating_mul(factor);
    Duration::from_secs(secs.min(BACKOFF_MAX.as_secs()))
}

/// Global (not per-client) login backoff, on `docs/design/access.md` §3.3's
/// curve: each consecutive failure doubles the wait before the next attempt is
/// accepted, from [`BACKOFF_BASE`] up to [`BACKOFF_MAX`].
///
/// A single shared counter is deliberate — the appliance has one admin
/// password, so per-client tracking buys nothing against an online guesser,
/// who would rotate source addresses anyway.
///
/// Two properties are load-bearing, and both were absent from the fixed
/// five-failures/30-seconds rule this replaces:
///
/// - **The counter survives an expired window.** Clearing `failures` when the
///   window lapses is what makes a flat rule flat: an attacker waits the
///   window out, and the next run starts from zero, so the cost per guess
///   never rises. Only [`LoginGuard::record_success`] resets the run, so
///   guessing gets monotonically more expensive — from 14400 guesses a day
///   under the old rule to under 300 once the cap is reached.
/// - **The curve never becomes permanent.** §6 pairs its `lockoutThreshold`
///   with "releasable only with physical presence", and apid has no presence
///   check to release one with. On an appliance whose only management surface
///   is this daemon, arming a threshold nothing can clear would let an
///   attacker convert a guessing attempt into a permanent denial of
///   management. The cap is therefore the whole control: a locked-out
///   administrator who knows the password waits at most [`BACKOFF_MAX`].
///
/// Still not implemented, and unchanged by this: §6 requires the counters live
/// in META rather than RAM, so an apid restart is a reset. That needs storage
/// apid does not have here and remains §6's work.
#[derive(Default)]
pub struct LoginGuard {
    failures: u32,
    locked_until: Option<Instant>,
}

impl LoginGuard {
    /// True when a login attempt may proceed; an elapsed window is cleared,
    /// but the failure run behind it is deliberately kept.
    pub fn check(&mut self) -> bool {
        match self.locked_until {
            Some(until) if until > Instant::now() => false,
            Some(_) => {
                self.locked_until = None;
                true
            }
            None => true,
        }
    }

    /// Record a failed login and arm the window this run has earned.
    pub fn record_failure(&mut self) {
        self.failures = self.failures.saturating_add(1);
        self.locked_until = Some(Instant::now() + backoff_for(self.failures));
    }

    /// Record a successful login, ending the failure run.
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
    fn backoff_doubles_from_the_base_and_stops_at_the_cap() {
        assert_eq!(backoff_for(0), Duration::ZERO);
        assert_eq!(backoff_for(1), BACKOFF_BASE);
        assert_eq!(backoff_for(2), Duration::from_secs(2));
        assert_eq!(backoff_for(3), Duration::from_secs(4));
        assert_eq!(backoff_for(9), Duration::from_secs(256));
        // The cap bites here and holds for every count past it, including the
        // ones where `2^(n-1)` no longer fits in a u64.
        assert_eq!(backoff_for(10), BACKOFF_MAX);
        assert_eq!(backoff_for(64), BACKOFF_MAX);
        assert_eq!(backoff_for(u32::MAX), BACKOFF_MAX);
    }

    #[test]
    fn one_failure_already_arms_a_window() {
        let mut guard = LoginGuard::default();
        assert!(guard.check());
        guard.record_failure();
        // The old rule allowed four free guesses before any cost at all.
        assert!(!guard.check());
    }

    #[test]
    fn an_elapsed_window_does_not_reset_the_run() {
        let mut guard = LoginGuard::default();
        for _ in 0..3 {
            guard.record_failure();
        }
        // Expire the window the way the clock would, without waiting on it.
        guard.locked_until = Some(Instant::now() - Duration::from_secs(1));
        assert!(guard.check());
        assert_eq!(guard.failures, 3, "riding out a window must not be free");

        // So the next failure escalates rather than restarting the curve.
        guard.record_failure();
        assert_eq!(guard.failures, 4);
    }

    #[test]
    fn success_ends_the_run_and_clears_the_window() {
        let mut guard = LoginGuard::default();
        for _ in 0..5 {
            guard.record_failure();
        }
        assert!(!guard.check());
        guard.record_success();
        assert!(guard.check());
        assert_eq!(guard.failures, 0);

        // A fresh run starts back at the base, not where the last one stopped.
        guard.record_failure();
        assert_eq!(guard.failures, 1);
    }

    #[test]
    fn the_lockout_is_never_permanent() {
        let mut guard = LoginGuard::default();
        for _ in 0..1000 {
            guard.record_failure();
        }
        let until = guard.locked_until.expect("a window is armed");
        // An administrator who knows the password waits at most BACKOFF_MAX --
        // there is no threshold past which the daemon stops answering, because
        // apid has no physical-presence release to clear one with.
        assert!(until <= Instant::now() + BACKOFF_MAX);
    }
}
