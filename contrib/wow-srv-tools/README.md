# WOW-SRV source handoff for review

This directory publishes the reviewed non-core source handoff alongside [core PR #18](https://github.com/tomaszkubiak-courses/vmangos-core/pull/18).

Start with [the source overview](review-source/README.md), [component inventory](review-source/COMPONENTS.tsv), [validation](review-source/VALIDATION.md), and [known issues](review-source/KNOWN-ISSUES.md).

The review snapshot contains the IIS Control Center, Windows lifecycle/deployment/collector tools, the separate wow-ops read-only adaptation, account-management WIP, and provenance. The account-management work is explicitly incomplete; the Windows operations retain their WOW-SRV guards and require host-specific rebinding before use elsewhere.

The 644 files under `review-source/` are byte-for-byte copies of `NONCORE-SOURCE-HANDOFF-R1-WOW-SRV-20261110-1125.zip`. Its SHA-256 is `7B3DE15806702EED7759616897A35D05875BB8B191244C6325E34D49AD8C38CA`. The included manifest covers 643 files and excludes itself.

The local attributes file preserves those source bytes on checkout. This wrapper and attributes file are publication metadata outside the original source manifest. Existing copyright and license notices are retained; open licensing and portability questions are documented in the source snapshot.

This is a draft review contribution. Publication does not authorize executing the host operations or activate the account gateway.
