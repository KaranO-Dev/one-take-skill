# Security

one-take runs on your own machine and never publishes, uploads or posts anything. It reads the repo and site you point it at. It writes only to the project folder it creates, to a GSAP cache in `~/.cache/one-take/`, and to temporary files it removes when it's done.

- Text from `take.json`, your copy and your git history goes into the build escaped, so it can't run as script in the page that HyperFrames renders.
- Languages, format ids, the slug and the output name are checked before any path is built from them, and files are only ever deleted inside the project's `out/` folder.
- GSAP is fetched from jsDelivr at a pinned version and checked against a pinned SHA-256, both after download and each time the cache is read. HyperFrames runs at a pinned version unless `take.json` names another.
- The probe's headless Chrome uses a temporary profile and is killed after 60 seconds (`ONE_TAKE_PROBE_TIMEOUT` changes that).

If you find a security problem, please email privacy@karano.me with the steps to reproduce it rather than opening a public issue. You'll get a reply within a few days.
