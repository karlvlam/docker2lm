# docker2lm
log shipper from docker to logmatic

# Dependencies
 - Node.js 7.6.0
 - dockerode


# How to run
1. set DOCKER_LM_CONFIG as config JSON string
2. run the script

## Configuration format
```json
{
    "apikey":"c3dc2345-82c6-4e63-ad8b-1a37c1817a51",
    "custom_field": {"type": "k8s", "env": "prod", "user": "John Doe"},
    "applog": {
        "label": {
            "io.kubernetes.pod.namespace": { "rename": "ns"}
            "io.kubernetes.container.name": { "rename": "container"}
        }
    },
    "stats": {},
    "event": {},

}
```

## Example
```bash
export DOCKER_LM_CONFIG=''
node docker2le
```
