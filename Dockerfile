FROM node:7.10.0-alpine

RUN mkdir -p /opt/docker2lm
RUN mkdir -p /opt/docker2lm/lib
WORKDIR /opt/docker2lm

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV
COPY package.json /opt/docker2lm
RUN npm install && npm cache clean
COPY docker2lm.js /opt/docker2lm
COPY lib/format.js /opt/docker2lm/lib

CMD [ "node", "--expose-gc", "/opt/docker2lm/docker2lm.js" ]
