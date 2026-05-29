# Real Run Evidence Folder

Place real cluster execution evidence here after running on a Spark/HDFS cluster.

Do not add fabricated logs. Use this folder for reproducibility evidence such as:

- `spark_applications.md`: Spark/YARN application IDs and links.
- `driver_stdout.log`: driver logs from `spark-submit`.
- `driver_stderr.log`: driver errors/warnings.
- `hdfs_manifest.txt`: `hdfs dfs -ls -R /data/drugtarget`.
- `hdfs_du.txt`: `hdfs dfs -du -h -s /data/drugtarget/*`.
- `spark_eventlog_manifest.txt`: Spark event log listing.
- `output_checksums.txt`: checksums for final Parquet/JSON/CSV artifacts.

Suggested capture commands:

```bash
yarn application -list -appStates FINISHED > yarn_finished_apps.txt
hdfs dfs -ls -R /data/drugtarget > hdfs_manifest.txt
hdfs dfs -du -h -s /data/drugtarget/* > hdfs_du.txt
hdfs dfs -ls /data/drugtarget/logs/spark-events > spark_eventlog_manifest.txt
```
