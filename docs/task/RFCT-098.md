# RFCT-098 The connd contract read rotted, and nineteen assertions went green on the fallback

- **status**: completed — implementation complete, `bash os/ui-location-test.sh` green (39/39 cases), full image chain green; two of the image verifier's three standing failures were this one defect
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-23 02:40
- **claimedAt**: 2026-08-23 02:40

`os/verify-image-v2.sh` reads the connd contract — config directories, unit
templates, rendered config names, networkd prefixes, and the namespace
`network.rs` sweeps — out of the reconcilers that own it, rather than
restating it. That design is right and this task does not change it. The
extractor for one of those values had rotted, and the consequences were not
"one check stopped working".

## What was wrong

`network.rs` used to sweep with `file_name.contains("-mos-")`. It was later
refactored to an anchored helper:

```rust
fn is_mos_managed(file_name: &str) -> bool {
    file_name.starts_with("50-mos-") && file_name.ends_with(".network")
}
```

The verifier's regex still looked for `file_name.contains("...")`. It matched
nothing, `MOS_SWEEP` became `""`, and **two of the image verifier's three
standing failures were that single empty string**:

- **The contract read failed** — correctly, and it said so:
  *"Every connd assertion below compares against these, so none of them mean
  anything until this passes."*
- **The namespace check reported eight collisions that could not happen.**
  The test was `case "${n}" in *"${MOS_SWEEP}"*)`, and with an empty marker
  that glob is `**`, which matches every filename. All eight stock systemd
  `.network` files were reported as colliding with a sweep that would never
  have touched them, since none of them starts with `50-mos-`.

And the part that is worse than either:

- **Nineteen assertions passed anyway.** Lines 328–348 of the run — hostapd
  and wpa_supplicant binaries, unit templates, the ExecStart/render-path
  pairing, mask state, the STATE binds, the `90-wifi-*` ordering — reached
  their values through `${STA_UNIT:-wpa_supplicant@.service}` and friends.
  With the contract unread they compared the image against **the verifier's
  own hardcoded restatement of a contract it had just failed to read**, and
  reported green. The FAIL line said they meant nothing; they went green
  anyway, and the total counted them.

This is the same family PLAN-011's campaigns kept turning up — a citation
nothing checks, a warning that always fires, an assertion that cannot fail, a
counter that cannot count — reached by a fourth route: **a fallback that turns
a failed measurement into a passing comparison.**

## What shipped

**The extractor matches the code again, and matches its shape.** The marker is
a PREFIX now, read from `starts_with(...)`, and the `.network` suffix is read
from `ends_with(...)` and asserted to be exactly that. Reading only the
prefix would describe a wider sweep than the code performs, and the collision
test would then be wrong in the other direction.

**The collision test is anchored**, `"${MOS_SWEEP}"*"${MOS_SWEEP_SUFFIX}"`
rather than `*"${MOS_SWEEP}"*`, matching `is_mos_managed` exactly. The eight
false positives are gone; a real `50-mos-eth0.network` in the image is still
caught, and there is now a case that proves it.

**The fallbacks are gone.** No `${STA_UNIT:-...}` anywhere. With the contract
unread the downstream assertions now FAIL with their own messages instead of
passing against a restatement. The FAIL text was corrected to say what is
actually true of them, rather than a claim about them not running.

**The namespace check refuses to run on an unread contract** — it is a
function, so an explicit early failure is cheap, and it says why: *"it
previously ran anyway with an empty marker, which made its glob match every
filename."*

**Both are hoisted above the fixture boundary**, into `read_connd_contract`
and `check_networkd_namespace`, and `MOS_VERIFY_RECONCILER_DIR` was added so a
fixture can point the contract read at a mutated copy of the reconcilers. That
override is the whole reason this rot is now drivable rather than waitable:
before it, no test could make the extraction fail.

## Verification

Three new cases in `os/ui-location-test.sh`, all against the REAL reconcilers
copied and mutated, never a directory the test authored:

- **the sweep marker moved behind a helper the extractor cannot read** —
  reproduces this defect. `starts_with("...")` is replaced by a call to a
  helper, exactly the shape the real refactor took. Both `connd-contract` and
  `networkd-namespace` must fail, each with its own message. This is the case
  that would have caught the original refactor on the day it landed.
- **an image `.network` file inside network.rs's sweep namespace** — the TRUE
  positive the unanchored glob could not distinguish from its eight false
  ones. A `50-mos-eth0.network` really would be deleted on the reconciler's
  first pass.
- **an image `.network` file inside the station reconciler's prefix** — the
  other namespace and the other failure mode: not swept but SHADOWING, since
  networkd applies the first match in lexical order.

`os/ui-location-test.sh`: 39/39 cases. Full image chain: the two failures this
defect produced are gone.

## What is NOT claimed

**The nineteen downstream assertions are still not individually drivable.**
They sit below the fixture boundary and read the real squashfs. What changed
is that they can no longer PASS on an unread contract — they fail. Hoisting
the whole connd group is a larger job and is not attempted here.

**The remaining verifier failure is untouched.** The U-Boot debug-variant
compare source is absent, so the uboot-mos/uboot pairing guard still cannot be
evaluated. That is a missing build artifact, not a verifier defect, and it is
not in this task's scope.
