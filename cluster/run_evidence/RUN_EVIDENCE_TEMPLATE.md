# Spark/HDFS Run Evidence Template

Use this file only after a real run. Replace every placeholder with real values.

## Run metadata

- Run date:
- Cluster name:
- Operator:
- Git commit:
- Spark version:
- Hadoop version:

## Spark applications

| Phase | Application ID | Status | Duration | Notes |
|---|---|---|---|---|
| DE | `application_...` | FINISHED | | |
| DA + ML | `application_...` | FINISHED | | |

## HDFS output summary

```text
Paste real hdfs dfs -du -h -s /data/drugtarget/* output here.
```

## Final artifact manifest

```text
Paste real hdfs dfs -ls -R /data/drugtarget/outputs output here.
```

## Validation checks

- GDC annotate rows:
- GEO annotate rows:
- STRING nodes:
- STRING edges:
- Candidate target rows:
- Protein target ranker targets:
- Protein target ranker clusters:

## Notes

Document warnings, failures, reruns, and deviations from default config.
