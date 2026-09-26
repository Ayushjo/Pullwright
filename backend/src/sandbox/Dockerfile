# Pullwright task sandbox. Runs as the unprivileged `node` user (uid 1000) with a
# read-only root filesystem; /tmp is a tmpfs and HOME points there.
FROM node:20-alpine

RUN apk add --no-cache git curl bash ripgrep python3 coreutils findutils grep sed

ENV HOME=/tmp \
    npm_config_cache=/tmp/.npm \
    npm_config_update_notifier=false \
    GIT_OPTIONAL_LOCKS=0 \
    PAGER=cat \
    CI=1

WORKDIR /workspace
USER node

CMD ["sleep", "infinity"]
