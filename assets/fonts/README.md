# Fonts / الخطوط

Put your font files here (you must own a license for them). The site looks for these exact file names
and falls back to similar Google Fonts if they are missing, so the site never breaks:

| Family (CSS name)          | Files to add (any one of them is enough)                                   | Used for                          |
|----------------------------|-----------------------------------------------------------------------------|-----------------------------------|
| `Tek Arabic Condensed`     | `TekArabic-Condensed.woff2` / `.ttf` / `.otf`                               | Headings, nav, buttons            |
| `Tek Arabic`               | `TekArabic.woff2` / `.ttf` / `.otf`                                         | Body text, forms                  |
| `29LT Riwaya informal`     | `29LTRiwaya-Informal.woff2` / `.ttf` / `.otf`                               | Small descriptive text            |
| `Cubao Wide`               | `CubaoWide.woff2` / `.ttf` / `.otf`                                         | AURABOT wordmark / Latin headings |

Want a different mapping? Change the 4 `--f-*` variables at the top of `assets/css/theme.css`.
