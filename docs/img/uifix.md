# UI review and remediation

Reviewed 2026-10-08. The seven reported issues have been addressed in the current working tree.

| Reported problem | Change |
| --- | --- |
| Oversized, bold form controls | Inputs and selects use regular weight and 14 px on desktop. Mobile retains 16 px to avoid focus zoom. Button sizing is defined in one base rule. |
| Too many competing actions | After loading, “Foto wählen” becomes a secondary “Bild ersetzen” action. Model export/import/delete sit under “Modelle verwalten”; collection export/delete sit under “Sammlung verwalten”. |
| Duplicate wing preview and upload dead space | The loaded upload preview is hidden; the original remains in review alongside the mask, normalized image and contour overlay. Capture controls become compact, bringing review closer. Replacement supports keyboard activation and selecting the same file again. |
| Long header status | A short status chip shows offline readiness. Its accessible description and tooltip retain the full explanation. Update instructions appear in App settings. |
| Overweighted mask warnings | The verdict uses neutral text. The compact review reason follows the images and orientation controls. Actual warnings, mandatory reasons and paired-image confirmation remain enforced. |
| Duplicate empty state and dense training introduction | The empty collection count/instructions are hidden while the main empty state is visible. Training starts with a short explanation and controls; readiness and protocol details are expandable. |
| Contradictory CSS patches | Product overrides are merged into the base component rules; identical media queries and duplicate selectors within each scope are consolidated. Responsive variants remain at the end. |

Verification: Node test suite, pipeline audit probes, and Chrome checks at desktop/mobile widths. Browser checks exercise empty references, model-management disclosure, typography, image loading, review reasons, acceptance, same-file replacement and all four views without horizontal overflow. The existing PWA smoke checks cover offline reload, persisted data, worker availability, updates and subdirectory hosting.

Research validation remains tracked in [pipeline-audit.md](../pipeline-audit.md); these interface changes do not establish biological identification accuracy.
