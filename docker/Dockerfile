FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
RUN apk add --no-cache ca-certificates curl iproute2 nftables tini tzdata procps logrotate
COPY root/ /opt/open-box/
COPY docker/ /opt/open-box/docker/
RUN chmod +x /opt/open-box/docker/bin/* /opt/open-box/debian/bin/* \
    && ln -s /opt/open-box/docker/bin/logread /usr/local/bin/logread \
    && ln -s /opt/open-box/openwrt/bin/open-box /usr/local/bin/open-box
ENV OPENBOX_PLATFORM=container OPENBOX_ROOT=/opt/open-box \
    LD_LIBRARY_PATH=/opt/open-box/node/lib OPENSSL_CONF=/dev/null \
    TZ=Asia/Shanghai OPENBOX_MASQUERADE=1
EXPOSE 3036/tcp 53/tcp 53/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD . /opt/open-box/docker/bin/panel-port && curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "-g", "--", "/opt/open-box/docker/bin/entrypoint"]
