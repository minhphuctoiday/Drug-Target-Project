# Distributed Big Data Execution Package

This folder documents how the project is intended to run on a 5-node Spark/HDFS environment.

Important: the current repository contains Colab-executed notebooks as the canonical executed pipeline artifacts:

- `notebooks/DE_onColab.ipynb`
- `notebooks/DA&ML_onColab.ipynb`

The files in this `cluster/` folder are **cluster-ready execution assets**, not fabricated proof of a completed 5-node run. If the pipeline is later executed on a real cluster, place the real Spark event logs, YARN application IDs, HDFS checksums, and driver logs under `cluster/run_evidence/`.

## 5-node target layout

- `node-master-01`: HDFS NameNode, YARN ResourceManager, Spark History Server.
- `node-worker-01`: HDFS DataNode, YARN NodeManager, Spark executor.
- `node-worker-02`: HDFS DataNode, YARN NodeManager, Spark executor.
- `node-worker-03`: HDFS DataNode, YARN NodeManager, Spark executor.
- `node-worker-04`: HDFS DataNode, YARN NodeManager, Spark executor.

## Pipeline stages

1. Data Engineering on Spark
   - Source notebook: `notebooks/DE_onColab.ipynb`
   - Cluster entrypoint: `src/distributed/de_spark_pipeline.py`
   - Submit script: `cluster/spark/submit_de.sh`

2. Data Analysis + ML on Spark driver / distributed feature layer
   - Source notebook: `notebooks/DA&ML_onColab.ipynb`
   - Cluster entrypoint: `src/distributed/da_ml_spark_pipeline.py`
   - Submit script: `cluster/spark/submit_da_ml.sh`

## Expected HDFS roots

```text
/data/drugtarget/raw
/data/drugtarget/refined
/data/drugtarget/outputs
/data/drugtarget/checkpoints
/data/drugtarget/logs
```

## Execution order

```bash
bash cluster/hdfs/bootstrap_hdfs_layout.sh
bash cluster/spark/submit_de.sh
bash cluster/spark/submit_da_ml.sh
```

## Evidence policy

Do not commit fabricated run logs. A real cluster run should capture:

- Spark application IDs.
- Spark UI screenshots or exported event logs.
- YARN application summaries.
- HDFS `du`, `ls`, and checksum outputs.
- Driver stdout/stderr.
- Final output manifest.
