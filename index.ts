import express, { NextFunction, Request, Response } from 'express';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { Participant, Rump, assertIsString } from './src/utils';
import { json } from 'body-parser';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
// eslint-disable-next-line node/no-unpublished-import
const participants = JSON.parse(readFileSync('./participants.json', 'utf-8'));
const app = express();
const server = createServer(app);
const io = new Server(server);
let clapping: Set<string> = new Set();

const AUTH_HEADER = 'rump-sthack-auth';
const CLAPPING_TTL = 1000;

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
  isAdmin?: Boolean | null;
}

io.on('connection', (socket: ISocket) => {
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
    const participant = socket.authenticatedParticipant;
    console.log(
      `clap event received (authenticated user : ${participant?.displayName})`
    );
    if (!participant) {
      console.log(`bad auth, ignored`);
      return;
    }
    const { qrCode } = participant;
    if (!clapping.has(qrCode)) {
      const key = process.env.DISABLE_THROTTLING
        ? qrCode + Math.random()
        : qrCode;
      clapping.add(key);
      socket.broadcast.emit('clapmeter', clapping.size);
      console.log(`clapmeter : ${clapping.size}`);
      setTimeout(() => {
        clapping.delete(key);
        socket.broadcast.emit('clapmeter', clapping.size);
        console.log(`clapmeter : ${clapping.size}`);
      }, CLAPPING_TTL);
    } else {
      console.log(`clapping too fast`);
    }
  });
  socket.on('clapmeter-reset', () => {
    if (!socket.isAdmin) {
      console.log(`no right to reset the clapmeter my dude`);
      return;
    }
    clapping.clear();
  });
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

server.listen(config.port, config.hostname, () => {
  console.log(`Server listening on ${config.hostname}:${config.port}`);
});
