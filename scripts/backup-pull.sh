#!/bin/bash
# AgehaOS 生产数据本地拉取备份（评审 2026-10-02 P0-2「本机拉取」档）。
# 每日由 Windows 计划任务调用；也可手动运行：bash scripts/backup-pull.sh
# 数据流：ssh ageha-hk tar server/data -> 本机 E:\agehaos-backups\（保留最近 14 份）。
# 恢复命令与口令位置见 E:\agehaos-backups\BACKUP-PASSPHRASE.txt 同级说明。
set -euo pipefail
DEST="${AGEHA_BACKUP_DIR:-/e/agehaos-backups}"
KEEP=14
# 到秒级（C2 审查：到分钟时同一分钟内两次运行会互相覆盖）。
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
if ssh -o ConnectTimeout=15 ageha-hk 'tar -C /opt/agehaos -czf - server/data' > "$DEST/.pull-$STAMP.tar.gz"; then
  mv "$DEST/.pull-$STAMP.tar.gz" "$DEST/ageha-local-$STAMP.tar.gz"
  ls -1t "$DEST"/ageha-local-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
  echo "local backup ok: ageha-local-$STAMP.tar.gz"
else
  rm -f "$DEST/.pull-$STAMP.tar.gz"
  echo "local backup FAILED at $STAMP"
  exit 1
fi
