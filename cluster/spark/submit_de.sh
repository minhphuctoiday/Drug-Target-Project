#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-DrugTarget-DE-Refined-Lake}"
HDFS_ROOT="${HDFS_ROOT:-hdfs:///data/drugtarget}"

spark-submit \
  --master yarn \
  --deploy-mode cluster \
  --name "${APP_NAME}" \
  --conf spark.sql.adaptive.enabled=true \
  --conf spark.sql.shuffle.partitions=160 \
  --conf spark.eventLog.enabled=true \
  --conf spark.eventLog.dir="${HDFS_ROOT}/logs/spark-events" \
  src/distributed/de_spark_pipeline.py \
  --raw-root "${HDFS_ROOT}/raw" \
  --refined-root "${HDFS_ROOT}/refined" \
  --checkpoint-root "${HDFS_ROOT}/checkpoints/de"
