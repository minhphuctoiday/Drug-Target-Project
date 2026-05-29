# Distributed Big Data Execution Design

## Purpose

This document describes how the project maps to a 5-node Spark/HDFS environment for a Big Data course.

The repository contains two Colab notebooks as the executed development runs:

- `notebooks/DE_onColab.ipynb`
- `notebooks/DA&ML_onColab.ipynb`

The cluster files under `cluster/` and `src/distributed/` provide the corresponding 5-node Spark/HDFS execution design and entrypoints. They are not fabricated evidence of a completed physical cluster run.

## Target 5-node architecture

```text
node-master-01
  - HDFS NameNode
  - YARN ResourceManager
  - Spark History Server
  - Spark submit gateway

node-worker-01..04
  - HDFS DataNode
  - YARN NodeManager
  - Spark executors
```

Recommended Spark settings:

```text
executor instances: 4
executor cores: 4
executor memory: 8g
driver memory: 8g
shuffle partitions: 160
AQE: enabled
HDFS replication: 3
```

## HDFS lake layout

```text
/data/drugtarget/raw
/data/drugtarget/refined
/data/drugtarget/outputs
/data/drugtarget/checkpoints
/data/drugtarget/logs/spark-events
```

## Pipeline mapping

| Phase | Colab notebook | Cluster entrypoint | Spark/HDFS role |
|---|---|---|---|
| DE | `DE_onColab.ipynb` | `src/distributed/de_spark_pipeline.py` | Builds refined Parquet lake from raw/refined intermediate tables |
| DA + ML | `DA&ML_onColab.ipynb` | `src/distributed/da_ml_spark_pipeline.py` | Builds target features, ranking features, KMeans clusters, and ML-ready artifacts |
| Serving | local backend/frontend | `src/backend/app.py` | Serves final artifacts through FastAPI and static dashboard |

## Distributed DE design

The DE stage is Spark-native because it involves large table normalization and joins:

- GDC counts joined with sample/case metadata.
- GEO expression joined with clinical metadata.
- STRING gene/protein mapping, node tables, and edge tables.
- Parquet output with repartitioning by gene symbol.
- Distributed QC using Spark counts and distinct counts.

Main distributed operations:

- `read.parquet`
- `join`
- `withColumn`
- `repartition`
- `write.parquet`
- `count`
- `countDistinct`

## Distributed DA/ML design

The DA/ML stage uses Spark DataFrames for target-level feature construction:

- tumor/normal grouped expression aggregation,
- GEO validation aggregation,
- STRING network feature joins,
- target score computation,
- distributed ranking with Spark windows,
- KMeans clustering with Spark MLlib.

The Colab notebook includes richer Python-side feature engineering and final model packaging. The distributed entrypoint expresses the same project intent for a Spark/HDFS environment and can be expanded into a full cluster production pipeline.

## Submit commands

Initialize HDFS layout:

```bash
bash cluster/hdfs/bootstrap_hdfs_layout.sh
```

Run Data Engineering:

```bash
bash cluster/spark/submit_de.sh
```

Run Data Analysis + ML:

```bash
bash cluster/spark/submit_da_ml.sh
```

## Evidence to collect after a real cluster run

Place real execution evidence under `cluster/run_evidence/`.

Recommended artifacts:

- Spark/YARN application IDs.
- Spark event log manifest.
- HDFS `ls -R` manifest.
- HDFS `du -h` summary.
- Driver stdout/stderr.
- Final output manifest and checksums.

Suggested commands:

```bash
yarn application -list -appStates FINISHED > cluster/run_evidence/yarn_finished_apps.txt
hdfs dfs -ls -R /data/drugtarget > cluster/run_evidence/hdfs_manifest.txt
hdfs dfs -du -h -s /data/drugtarget/* > cluster/run_evidence/hdfs_du.txt
hdfs dfs -ls /data/drugtarget/logs/spark-events > cluster/run_evidence/spark_eventlog_manifest.txt
```

## Honest project statement

Use this statement in reports:

> The project was developed and validated with Colab notebooks over refined Parquet artifacts. To align with the Big Data course requirement, the repository also includes a Spark/HDFS 5-node execution design, cluster submit scripts, HDFS layout, and Spark entrypoints mapping the same DE and DA/ML stages to a distributed environment. Real 5-node run evidence should be collected under `cluster/run_evidence/` when executed on a physical cluster.

Avoid this statement unless a real cluster run has been completed:

> The full DE/DA/ML pipeline was executed on a physical 5-node Spark/HDFS cluster.
