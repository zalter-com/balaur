# Balaur

`Balaur` is a daemonizing manager for Node.js applications written in order to be able to create
`systemctl` services for `*nix` systems. It allows you to run the applications as services (daemons)
on *nix systems, with all the features attached to that (start, stop, restart and status).

## Installing Balaur

### Globally

```shell
npm install -g balaur
```

### Locally

```shell
npm install balaur
```

### Configuration

Create a file in your project named `balaur.config.mjs`

Alternatively you can export an environment variable called `BALAUR_CONFIG_FILE` with the path.

In this file you can specify the following values:

```js
export default {
  main: "index.mjs",
  workers: 1,
  pidfilePath: "pidfile.pid",
  stdOutPath: "out.log",
  stdErrPath: "err.log"
}
```

- `main` - default `index.mjs` - represents the file that exports the default function that will be
  daemonized
- `workers` - default `1` on `NODE_ENV === development` and cpu count on other values - the number
  of spawned processes (see threads vs process Node.js and C10K problem)
- `pidfilePath` - default `pidfile.pid` - the file which maintains the `pid` of the master process
- `stdOutPath` - default `out.log` - the file (or socket) where the `stdout` will be redirected
- `stdErrPath` - default `err.log` - the file (or socket) where the `stderr` will be redirected

## Commands

- `start` starts a daemon and detaches it creating an IPC Channel for its stderr and stdout
- `stop` stops the daemon by sending a unix signal, can only be used on started daemons
- `restart` restarts the daemon by sending a unix signal, can only be used on started daemons

All daemons respect unix signals.

## Usage

### Execute remote with NPX

```shell
npx balaur [command]
```

### Bin

```shell
balaur [command]
```

### Custom execution

> **NOTE:** On custom execution the config file does not apply.

Create a `index.mjs` file with the code similar to the following:

```javascript
import Balaur from 'balaur';

const config = {
  workers: process.env.NODE_ENV !== 'development' ? cpus().length : 1,
  pidfilePath: 'pidfile.pid',
  stdOutPath: 'out.log',
  stdErrPath: 'err.log'
};

const balaur = new Balaur(() => {
  // Your daemonized code goes here
  console.log('Hello, World!');
}, config);

balaur.processArgs();
```

## systemctl service creation

In your project edit the `package.json` and modify the following scripts:

```json
{
  "scripts": {
    "start": "balaur start",
    "stop": "balaur stop",
    "restart": "balaur restart"
  }
}
```

If you used custom execution

```json
{
  "scripts": {
    "start": "node ./ start",
    "stop": "node ./ stop",
    "restart": "node ./ restart"
  }
}
```

### Config the service

Create a user to run your service. This is important to protect your system in case the service can
be hacked.

```shell
sudo adduser \
   --system \
   --shell /bin/bash \
   --gecos 'node' \
   --disabled-password \
   --home /srv/www \
   node
```

Create a file in `/lib/systemd/system/myservice.service` where `myservice` is the name of your
service

Paste the following inside:

```shell
[Unit]
Description=My Service
After=network-online.target
Wants=network-online.target

[Service]
User=node
Group=nogroup
WorkingDirectory=/srv/www/path/to/your/project
Type=forking
ExecStart=/usr/bin/npm start
ExecStop=/usr/bin/npm stop
LimitCPU=infinity


[Install]
WantedBy=multi-user.target
```

### Reload the daemons

```shell
sudo systemctl daemon-reload
```

### Start/stop/restart daemons

```shell
sudo service myservice [start | stop | restart | status]
```

or

```shell
sudo systemctl [start | stop | restart | status] myservice
```

### Enable auto-running on system restart

```shell
sudo systemctl enable myservice
```

### Disable auto-running on system restart

```shell
sudo systemctl disable myservice
```
