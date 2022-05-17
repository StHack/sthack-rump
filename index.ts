import express, { NextFunction, Request, Response } from 'express';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { Participant, Rump, assertIsString } from './src/utils';
import { json } from 'body-parser';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

enum RumpStatus {
  waiting = 'waiting',
  running = 'running',
  timeover = 'time-over',
  kicked = 'kicked',
}

// eslint-disable-next-line node/no-unpublished-import
const participants = JSON.parse(readFileSync('./participants.json', 'utf-8'));
const app = express();
const server = createServer(app);
const io = new Server(server);
const clapping: Map<string, ReturnType<typeof setTimeout>> = new Map();
let rumpStatus = RumpStatus.waiting;
let startTimestamp: number;
let timer: ReturnType<typeof setInterval>;
const clapThreshold = Math.floor(Object.keys(participants).length / 2);
const AUTH_HEADER = 'rump-sthack-auth';
const CLAPPING_TTL = 1000;
const RUMP_MINUTES = 1;

function authenticate(qrCode: string | undefined) {
  if (qrCode) {
    return participants[qrCode];
  }
  return undefined;
}

function authenticateAdmin(password: string | undefined) {
  return password === process.env.ADMIN_PW;
}

function authenticationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const rumpSthackAuthHeader = req.header(AUTH_HEADER);
  const participant = authenticate(rumpSthackAuthHeader);
  if (participant) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    req.participant = participant;
    return next();
  }
  res.status(401);
  throw Error('Invalid authentication');
}

function initConfig() {
  return {
    port: process.env.STHACK_RUMP_PORT
      ? parseInt(process.env.STHACK_RUMP_PORT, 10)
      : 3000,
    hostname: process.env.STHACK_RUMP_HOSTNAME ?? 'localhost',
  };
}
const config = initConfig();

app.use(express.static('app'));

app.use(authenticationMiddleware);
app.use(json());

app.get('/rump', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const participant = req.participant;
  const rumpFile = `rumps/${participant.qrCode}.json`;
  let rump: Rump = {
    title: '',
    description: '',
    speaker: '',
  };
  if (existsSync(rumpFile)) {
    rump = JSON.parse(readFileSync(rumpFile, 'utf-8'));
  }

  assertIsString(rump.description);
  assertIsString(rump.speaker);
  assertIsString(rump.title);
  res.send(rump);
});

app.put('/rump', (req, res) => {
  console.log(req.body);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const participant = req.participant;
  const rumpFile = `rumps/${participant.qrCode}.json`;
  const rump: Rump = {
    title: req.body.title ?? '',
    description: req.body.description ?? '',
    speaker: req.body.speaker ?? '',
  };

  writeFileSync(rumpFile, JSON.stringify(rump), 'utf-8');
  res.send(rump);
});

interface ISocket extends Socket {
  authenticatedParticipant?: Participant | null;
  isAdmin?: boolean | null;
}

io.on('connection', (socket: ISocket) => {
  // Helper for the bricolage
  const broadcast = (event: string, value: any) => {
    socket.emit(event, value);
    socket.broadcast.emit(event, value);
  };
  console.log('a user connected');
  socket.on('auth', (qrCode: string) => {
    console.log(`auth with QR code : ${qrCode}`);
    const participant = authenticate(qrCode);
    if (authenticate(qrCode)) {
      socket.authenticatedParticipant = participant;
    } else {
      socket.authenticatedParticipant = null;
    }
  });
  socket.on('auth-admin', (password: string) => {
    if (authenticateAdmin(password)) {
      console.log(`admin auth success`);
      socket.isAdmin = true;
    } else {
      console.log(`admin auth failure`);
    }
  });
  socket.on('clap', () => {
    if (rumpStatus !== RumpStatus.running) {
      console.log(`rump not running, ignoring clap event`);
      return;
    }
    const participant = socket.authenticatedParticipant;
    console.log(
      `clap event received (authenticated user : ${participant?.displayName})`
    );
    if (!participant) {
      console.log(`bad auth, ignored`);
      return;
    }
    const { qrCode } = participant;

    const key = process.env.DISABLE_THROTTLING ? socket.id : qrCode;

    const timeout = clapping.get(key);
    if (timeout) {
      clearTimeout(timeout);
    }

    clapping.set(
      key,
      setTimeout(() => {
        clapping.delete(key);
        broadcast('clapmeter', {
          current: clapping.size,
          max: clapThreshold,
        });
      }, CLAPPING_TTL)
    );
    if (clapping.size >= clapThreshold) {
      console.log('clapping threshold reached !');
      clearInterval(timer);
      broadcast('rump-status', RumpStatus.kicked);
    } else {
      broadcast('clapmeter', {
        current: clapping.size,
        max: clapThreshold,
      });
    }
  });
  socket.on('get-rump-status', () => {
    console.log(`get-rump-status -> ${rumpStatus}`);
    socket.emit('rump-status', rumpStatus);
  });
  socket.on('set-rump-status', (newStatus: RumpStatus) => {
    if (!socket.isAdmin) {
      console.log(`no right to change rump status`);
      return;
    }
    console.log(`set-rump-status to ${newStatus}`);
    if (newStatus === RumpStatus.running) {
      // start timer
      startTimestamp = Date.now();
      timer = setInterval(() => {
        const elapsedSeconds = Math.ceil((Date.now() - startTimestamp) / 1000);
        let remainingTime = RUMP_MINUTES * 60 - elapsedSeconds;
        if (remainingTime <= 0) {
          remainingTime = 0;
          broadcast('timer', remainingTime);
          clearInterval(timer);
          broadcast('rump-status', RumpStatus.timeover);
        }
        broadcast('timer', remainingTime);
      }, 100);
    } else {
      broadcast('timer', 0);
      clearInterval(timer);
    }
    rumpStatus = newStatus;
    // Reset clapmeter at every status change
    for (const timeout of clapping.values()) {
      clearTimeout(timeout);
    }
    clapping.clear();
    broadcast('clapmeter', {
      current: clapping.size,
      max: clapThreshold,
    });
    broadcast('rump-status', newStatus);
  });
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

server.listen(config.port, config.hostname, () => {
  console.log(`Server listening on ${config.hostname}:${config.port}`);
});
