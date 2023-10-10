FROM denoland/deno:alpine-1.37.1

RUN apk add tzdata &&  \
    adduser deno users && \
    cp /usr/share/zoneinfo/America/Los_Angeles /etc/localtime && \
    echo "America/Los_Angeles" > /etc/timezone && \
    apk del tzdata

EXPOSE 3001

WORKDIR /app

ADD . .
RUN deno cache src/server.ts

ENTRYPOINT ["deno", "run", "--no-prompt", "--allow-env", "--allow-read", "--allow-net", "--unsafely-ignore-certificate-errors", "src/server.ts"]
CMD ["-c", "/app/context.json", "-s", "/app/schema.graphql"]
