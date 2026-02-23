# mdxplay.exe C -> JS module mapping

The browser player keeps one JS module for every source that `mdxplay` links in `Makefile`.

- `mdxplay.c` -> `web/mdxplay.js` + `web/mdxplay_app.js` + `web/mdxplay.html`
- `mdx_driver.c` -> `web/mdx_driver.js`
- `timer_driver.c` -> `web/timer_driver.js`
- `adpcm_driver.c` -> `web/adpcm_driver.js`
- `fm_driver.c` -> `web/fm_driver.js`
- `tools.c` -> `web/tools.js`
- `adpcm.c` -> `web/adpcm.js`
- `speex_resampler.c` -> `web/speex_resampler.js`
- `ym2151.c` -> `web/ym2151.js`
- `fixed_resampler.c` -> `web/fixed_resampler.js`
- `mdx.c` -> `web/mdx.js`
- `pdx.c` -> `web/pdx.js`
- `cmdline.c` -> `web/cmdline.js` (browser stub)
- `adpcm_pcm_mix_driver.c` -> `web/adpcm_pcm_mix_driver.js`
- `fm_opm_emu_driver.c` -> `web/fm_opm_emu_driver.js`
- `pcm_timer_driver.c` -> `web/pcm_timer_driver.js`
- `fm_opm_driver.c` -> `web/fm_opm_driver.js`
- `sinctbl3.h` -> `web/sinctbl3.js`
- `sinctbl4.h` -> `web/sinctbl4.js`
- `vgm_logger.c` -> `web/vgm_logger.js`

`web/mdxplay.html` and `web/mdxplay_app.js` are the browser front-end that replace `mdxplay.c` CLI/audio backend.
