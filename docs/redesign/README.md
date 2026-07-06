# DermaGuru redesign — visual reference

One unified **"clinical-calm / quiet-luxe"** system that replaces the three competing identities currently in
`src/app/globals.css` (calm teal advisor + neon "brutalist" live-search + pink commerce home).

| Artboard | What it shows |
| --- | --- |
| `01-widget-en.png` | Embeddable advisor — **English / LTR**, teal tenant: launcher, panel, disclaimer bar, intake chips, grounded product cards (incl. **sponsored** disclosure), composer. |
| `02-widget-ar.png` | Same component — **Arabic / RTL**, rose tenant: fully mirrored, with the **red-flag → referral** safety state and a still-helpful, non-medical follow-up. |
| `03-landing-system.png` | Landing hero + the **design-system board**: color tokens, type scale, and canonical components. |

PNGs are generated (crisp 2×) from `build.mjs`:

```bash
node docs/redesign/build.mjs   # writes *.svg + *.png using the repo's local sharp
```

Tokens, type, components, motion and accessibility rules are specified in
[`../DermaGuru_Build_Spec.md` §3](../DermaGuru_Build_Spec.md). These boards are the visual target; the spec is
the build contract.
