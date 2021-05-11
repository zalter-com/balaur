import childProcess from 'child_process';
import cluster from 'cluster';
import fs from 'fs';
import os, { cpus } from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

let console = global.console;
const noop = () => {};

/**
 * @typedef BalaurConfig
 * @property {number} workers
 * @property {string} pidfilePath
 * @property {string} stdOutPath
 * @property {string} stdErrPath
 */

export default class Balaur {
  static get EXIT_CODE_OK() { return 0; };

  static get EXIT_CODE_CATCH_ALL() { return 1; };

  static get EXIT_CODE_CANNOT_EXECUTE() { return 126; };

  static get EXIT_CODE_CONTROL_C() { return 130; };

  static get EXIT_CODE_UNHANDLED_REJECTION() { return 131; };

  static get EXIT_CODE_UNHANDLED_EXCEPTION() { return 132; };

  static get EXIT_CODE_TERMINATED() { return 255; };

  /**
   * The function that needs to run as daemon
   * @type {function}
   */
  #daemonizedFunction = noop();

  /**
   * Number of threads (usually equal to hyper thread CPUs).
   * @type {number}
   */
  #workers;

  /**
   * File path for process id storage.
   * @type {string}
   */
  #pidfilePath;

  /**
   * File path for standard output.
   * @type {string}
   */
  #stdOutPath;

  /**
   * File path for standard error.
   * @type {string}
   */
  #stdErrPath;

  /**
   * The process id of the current running daemon.
   * @type {number | null}
   */
  #pid = null;

  /**
   * Start command for system daemon.
   * @param {Object<string, *>} yargs
   */
  #start = (yargs) => {
    if (!yargs.verbose) {
      console = {
        info: noop,
        log: noop,
        warn: global.console.warn,
        error: global.console.error
      };
    }

    if (process.pid === this.#pid) {
      this.#startSequence();
    } else {
      if (!this.#processExists()) {
        this.#startDaemon(yargs.inspect);
      } else {
        if (cluster.isMaster) {
          console.error(`Daemon already started, unable to start.
Please use stop & start or restart.`);
          process.exit(Balaur.EXIT_CODE_CANNOT_EXECUTE);
        }

        if (cluster.isWorker) {
          this.#startSequence();
        }
      }
    }
  };

  /**
   * Restart command for system daemon.
   * @param {Object<string, *>} yargs
   */
  #restart = (yargs) => {
    if (!this.#processExists()) {
      console.error('Daemon not started, unable to restart.');
      process.exit(Balaur.EXIT_CODE_CANNOT_EXECUTE);
    } else {
      if (os.platform() === 'win32') {
        console.error('Windows does not support POSIX, unable to restart.');
        process.exit(Balaur.EXIT_CODE_CANNOT_EXECUTE);
      }

      fs.writeFileSync(this.#pidfilePath, this.#pid ? `${this.#pid}` : '');
      process.kill(this.#pid, process.platform.startsWith('win') ? 'SIGINT' : 'SIGHUP');
      process.exit(Balaur.EXIT_CODE_OK);
    }
  };

  /**
   * Stop command for system daemon.
   * @param {Object<string, *>} yargs
   */
  #stop = (yargs) => {
    if (!this.#processExists()) {
      console.error('Daemon not started, unable to stop.');
      process.exit(Balaur.EXIT_CODE_CANNOT_EXECUTE);
    } else {
      fs.writeFileSync(this.#pidfilePath, this.#pid ? `${this.#pid}` : '');

      if (yargs.force) {
        process.kill(this.#pid, 'SIGTERM');
      } else {
        process.kill(this.#pid, 'SIGINT');
      }

      process.exit(Balaur.EXIT_CODE_OK);
    }
  };

  /**
   *
   * @param daemonizedFunction
   * @param { BalaurConfig } config
   */
  constructor(daemonizedFunction, config) {
    this.#daemonizedFunction = daemonizedFunction;
    this.#workers = config?.workers || (process.env.NODE_ENV === 'development' ? 1 : cpus().length);
    this.#pidfilePath = config?.pidfilePath || 'pidfile.pid';
    this.#stdOutPath = config?.stdOutPath || 'out.log';
    this.#stdErrPath = config?.stdErrPath || 'err.log';

    try {
      fs.accessSync(this.#pidfilePath, fs.constants.R_OK);
      const data = fs.readFileSync(this.#pidfilePath, 'utf-8');

      if (data) {
        this.#pid = parseInt(data);
        this.#pid = Number.isNaN(this.#pid) ? null : this.#pid;
      }
    } catch {
      // Silent catch
    }
  }

  /**
   * Checks whether the process exists via POSIX kill signal.
   * @return {boolean}
   */
  #processExists() {
    try {
      return process.kill(this.#pid, 0);
    } catch (err) {
      return err.code === 'EPERM';
    }
  }

  /**
   * Starts the daemonizer.
   * @param {boolean} inspect Whether it should start Node.js inspect session.
   */
  #startDaemon(inspect = false) {
    console.info('Daemon starting.');

    const argv = [].concat(process.argv);

    argv.shift(); // Remove "node" argument

    const path = argv.shift();

    const forkOptions = {
      detached: true
    };

    if (this.#stdOutPath && this.#stdErrPath) {
      const outFileDescriptor = fs.openSync(this.#stdOutPath, 'a');
      const errFileDescriptor = fs.openSync(this.#stdErrPath, 'a');

      forkOptions.stdio = ['ignore', outFileDescriptor, errFileDescriptor, 'ipc'];
    } else {
      forkOptions.stdio = ['pipe', 'pipe', 'pipe', 'ipc'];
    }

    inspect && (forkOptions.execArgv = ['--inspect']);
    const child = childProcess.fork(path, argv, forkOptions);

    fs.writeFileSync(this.#pidfilePath, child.pid.toString());
    child.unref(); // Even detached, unref is required
    console.info('Daemon started.');
    process.exit(Balaur.EXIT_CODE_OK);
  }

  /**
   * Forker part of the daemonized starting function.
   */
  #startSequence() {
    if (cluster.isMaster) {
      console.info('Cluster master sequence starting.');

      for (let i = 0; i < this.#workers; i++) {
        cluster.fork();
      }

      let exitCount = 0;
      let gracefulExitCount = 0;

      cluster.on('exit', (worker, code, signal) => {
        console.info(`Cluster worker with PID ${worker.process.pid} exited with code ${code} and signal ${signal}.`);

        if (worker.exitedAfterDisconnect) {
          console.info('Cluster worker exited after disconnect.');

          if (++gracefulExitCount === this.#workers) {
            console.info('All cluster workers exited gracefully.');
          }

          return;
        }

        if (exitCount++ > 10) {
          console.error('Cluster worker exited too many times, unable to fork any further.');
          return;
        }

        if (code === Balaur.EXIT_CODE_UNHANDLED_REJECTION) {
          console.error(`Cluster worker exited with code ${Balaur.EXIT_CODE_UNHANDLED_REJECTION} (unhandled rejection), unable to fork any further.`);
          return;
        }

        if (code === Balaur.EXIT_CODE_UNHANDLED_EXCEPTION) {
          console.error(`Cluster worker exited with code ${Balaur.EXIT_CODE_UNHANDLED_EXCEPTION} (unhandled exception), unable to fork any further.`);
          return;
        }

        cluster.fork();
        console.info('Cluster worker forked again.');
      });

      process.on('SIGHUP', () => {
        console.info('Process received SIGHUP, restarting cluster cluster workers.');

        // @TODO: Finish the restart sequence for the new changes on node.
        // if (this.#NODE_ENV !== "development") {
        //   cluster.disconnect(() => {
        //     process.exit();
        //     this.startDaemon();
        //   });
        // } else {
        cluster.disconnect();

        const clusterWorkers = Object.values(cluster.workers);

        for (const worker of clusterWorkers) {
          worker.process.kill('SIGKILL');
          console.info(`Cluster worker (PID ${worker.process.pid}) killed with SIGTERM.`);
        }

        this.#startDaemon();
        // }
      });

      process.on('SIGINT', () => {
        console.info('Process received SIGINT, disconnecting cluster workers.');
        console.info('Active connection may or may not be stopped. Use --force to ensure.');
        cluster.disconnect();
        process.exit();
      });

      process.on('SIGTERM', () => {
        console.info('Process received SIGTERM, disconnecting cluster workers.');
        cluster.disconnect();

        const clusterWorkers = Object.values(cluster.workers);

        for (const worker of clusterWorkers) {
          worker.process.kill('SIGKILL');
          console.info(`Cluster worker (PID ${worker.process.pid}) killed with SIGTERM.`);
        }

        console.info('Process terminated.');
        process.exit(Balaur.EXIT_CODE_TERMINATED);
      });
    }

    if (cluster.isWorker) {
      const originalConsole = { ...global.console };
      ['log', 'warn', 'info', 'error'].forEach((fnName) =>
        global.console[fnName] = (...args) =>
          originalConsole[fnName](`Worker ${cluster.worker.process.pid}:\t`, ...args)
      );
      console.info('Cluster worker sequence starting.');
      const result = this.#daemonizedFunction();

      if (result?.then) {
        result
          .then(() => {
            console.info(
              `Daemon started on cluster worker (PID ${cluster.worker.process.pid}).`
            );
          })
          .catch((err) => {
            console.error(
              `Daemon start failed on cluster worker (PID ${cluster.worker.process.pid}).`,
              err);
          });
      }
    }
  };

  /**
   * Starts the yargs processing of commands and executes them accordingly.
   * @return {*}
   */
  processArgs() {
    return yargs(hideBin(process.argv))
      .usage('Application daemon\n\nUsage: $0 [command]')
      .help('help').alias('help', 'h')
      .version('version', '1.0.0').alias('version', 'V')
      .count('verbose').alias('v', 'verbose')
      .demandCommand(1)
      .command('start', 'Start daemon', (yargs) => {
        return yargs.options('inspect', {
          alias: 'd',
          default: false,
          describe: 'Start node in inspect mode',
          type: 'boolean'
        });
      }, this.#start)
      .command('restart', 'Restart daemon', () => {}, this.#restart)
      .command('stop', 'Stop daemon', (yargs) => {
        return yargs.options('force', {
          alias: 'f',
          default: false,
          describe: 'Force stop',
          type: 'boolean'
        });
      }, this.#stop)
      .argv;
  }
}
