# Estedad fonts

Unmodified static Regular and Bold fonts from
[aminabedi68/Estedad](https://github.com/aminabedi68/Estedad), pinned to upstream
commit `0dbe689787b8c2ea302373cb601d0f352f9f98e5` (`fonts/ttf/`).
Redistributed under the SIL Open Font License 1.1; see [OFL.txt](OFL.txt).

| File | SHA-256 |
| --- | --- |
| Estedad-Regular.ttf | `812996efdeff8fd68bb854fbb3db218886661fbfd50ed38a06d50bd14c1f3c7f` |
| Estedad-Bold.ttf | `7fa317abae24c82aef5a5816bba4be8b86b344bd740c600276bcb738e416dd76` |

The renderer loads these local files with system fonts disabled. Vercel's
`includeFiles` explicitly includes this directory in the webhook function.
Rendering never downloads a font or depends on a machine-installed font.
