### Task 14 — Deferred owner actions: DNS A record + HTTPS-only verification runbook (NOT executed)
<!-- vg-binding: SPECS:success-criteria -->
<wave>5</wave>
<manual>true</manual>
<implements-decision>M2.D-65</implements-decision>
<implements-decision>M2.D-69</implements-decision>
<implements-decision>M2.D-68</implements-decision>
<file-path>.vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md</file-path>
<goals-covered>G-03,G-05,G-06,G-11</goals-covered>
<estimated-loc>110</estimated-loc>

Covers goal: G-03, G-05, G-06, G-11

**Description:** Write the runbook for the four success criteria that are **physically
unverifiable on this machine** — they need the real DNS record, a real Let's Encrypt cert and a
real browser on HTTPS. **The executor writes this document and nothing else.** It must not run
`./deploy.sh`, `git push`, `ssh`, or `docker compose -f docker-compose.prod.yml up`: the owner
forbade touching the production server (P08.D-72). The DNS change is a manual owner action at the
registrar, outside code entirely.

**Read first:** `.vg/phases/07-ha-tang-trang-khach/SPECS.md` § Success criteria (AC-Q3, AC-Q5,
AC-Q6 + the 2026-07-29 `Referrer-Policy` / `/uploads/` addendum), `DEPLOY.md`, `Caddyfile`
(post-Task-11), `.env.production.example` (post-Task-09).

**Steps — the document must contain, in order:**
1. **Header banner:** "KHÔNG DEPLOY trong phase 07 (P08.D-72). Tài liệu này chỉ để chủ quán chạy
   TAY sau khi tự quyết định deploy." Plus the state this phase leaves behind: all code/config
   changes are local commits on `feat/online-ordering`, nothing has been pushed or deployed.
2. **Step 0 — owner action, not automatable:** add DNS `A` record
   `order.quanbalun.site` → VPS IP at the registrar; wait for propagation; verify with
   `dig +short order.quanbalun.site` matching `dig +short quanbalun.site`. Note that
   `Caddyfile`'s apex HSTS uses `includeSubDomains`, so the subdomain **must** have a valid cert
   before any browser will load it over plain HTTP — there is no HTTP-only fallback path.
3. **Step 1 — deploy (owner decides when):** reference `./deploy.sh` + `.env.deploy` +
   `/deploy-vps` skill and the two env keys that must be set in `.env.production` first:
   `DOMAIN=quanbalun.site` and the 3-origin `ALLOWED_ORIGIN` from Task 09. State plainly that no
   task in this plan runs it.
4. **Deferred check D-1 → G-06 (AC-Q6):**
   `curl -I https://order.quanbalun.site` → expect `HTTP/2 200`, valid cert (add
   `curl -vI` cert-issuer line and `openssl s_client -connect order.quanbalun.site:443 -servername order.quanbalun.site` as the fallback probe).
5. **Deferred check D-2 → G-11:** the same `curl -I` must show `Referrer-Policy: no-referrer`
   **and** `Permissions-Policy: geolocation=(self), …`; and
   `curl -I https://order.quanbalun.site/uploads/menu/<một-file-thật>` → `200` with
   `content-type: image/*`. Include the command to list a real filename from the VPS uploads
   volume (owner runs it), and the expected failure mode if `main.ts` middleware ordering
   regressed (HTML instead of the image).
6. **Deferred check D-3 → G-05 (AC-Q5):** on a real phone browser open
   `https://order.quanbalun.site/`, tap "Chia sẻ vị trí", accept the permission prompt, expect
   lat/lng. Document both failure signatures: silent no-op / immediate `PERMISSION_DENIED` with no
   prompt ⇒ `Permissions-Policy` still `geolocation=()` (check which site block served the
   request); prompt appears but times out ⇒ device GPS, not our config.
7. **Deferred check D-4 → G-03 (AC-Q3):** log in to the POS at `https://quanbalun.site`, then open
   `https://order.quanbalun.site` in the same browser profile, DevTools → Network → any request →
   Request Headers must contain **no** `ssp_token` cookie. Cross-reference the local static half of
   this check (Task 13 Section C asserts `cookieOptions` has no `domain`).
8. **Rollback note:** if any deferred check fails, the recovery path is `git revert` of the phase-07
   commits + redeploy — the phase adds no DB migration, no schema change (`synchronize: true`,
   M2.D-07) and no data mutation, so rollback is code-only. The `order.` DNS record can stay.
9. **Sign-off table:** one row per deferred goal (G-03, G-05, G-06, G-11) with columns
   Check / Command / Expected / Observed / Date / Result, left blank for the owner to fill.

**Acceptance criteria:**
- [ ] `DEFERRED-VPS-CHECKS.md` exists with the banner, Step 0 (DNS), Step 1 (deploy reference),
      D-1..D-4, rollback note and an empty sign-off table.
- [ ] Every deferred check states the exact command, the expected output **and** the diagnostic
      meaning of each failure mode.
- [ ] The document explicitly names G-03, G-05, G-06, G-11 as DEFERRED and cross-links the local
      partial coverage (Task 11 config assertions, Task 13 Section C/E).
- [ ] No command in the document is executed by this task — the file is documentation only.
- [ ] Verified by grep that the executor ran nothing: no new entries in shell history is not
      checkable, so instead assert the working tree contains no deploy artefacts and
      `git log origin/main..HEAD` shows nothing pushed.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
test -f .vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md && echo 'runbook present'
grep -c 'G-03\|G-05\|G-06\|G-11' .vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md
grep -n 'KHÔNG DEPLOY' .vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md
git status --short          # expect only phase-07 files, no deploy side effects
git log --oneline -1        # expect the last commit is local; nothing pushed
```
