# Benchmark fixtures

Not committed — this repo has no real product/reference photos to check in.
Drop real files here before running `runBenchmark.ts` for real (see
`../../../mobile/docs/polish/ai-provider-benchmark/README.md` for the exact
command):

```
fixtures/logo-tee.png
fixtures/knit-sweater.png
fixtures/denim.png
fixtures/jacket.png
fixtures/dress.png
fixtures/refs/studio-clean.png
fixtures/refs/street-night.png
fixtures/refs/exotic-location.png
```

`matrix.ts` is the source of truth for these exact filenames. Running
without them prints exactly which ones are missing rather than failing
silently; `--mock` skips the fixture requirement entirely (see the
runner's own header comment).
