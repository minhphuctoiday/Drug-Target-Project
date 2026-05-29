#!/usr/bin/env bash
set -euo pipefail

HDFS_ROOT="${HDFS_ROOT:-/data/drugtarget}"

hdfs dfs -mkdir -p \
  "${HDFS_ROOT}/raw/gdc" \
  "${HDFS_ROOT}/raw/geo" \
  "${HDFS_ROOT}/raw/string" \
  "${HDFS_ROOT}/refined/gdc" \
  "${HDFS_ROOT}/refined/geo" \
  "${HDFS_ROOT}/refined/STRING" \
  "${HDFS_ROOT}/outputs/ml_inputs" \
  "${HDFS_ROOT}/outputs/ml_models" \
  "${HDFS_ROOT}/outputs/biological_evidence" \
  "${HDFS_ROOT}/checkpoints" \
  "${HDFS_ROOT}/logs/spark-events"

hdfs dfs -chmod -R 775 "${HDFS_ROOT}"

echo "HDFS layout initialized under ${HDFS_ROOT}"
echo "Replication summary:"
hdfs dfs -ls -R "${HDFS_ROOT}" | head -100
