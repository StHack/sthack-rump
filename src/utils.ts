import { PDF_QR_JS } from 'pdf-qr';
import * as fs from 'fs';
import CsvReadableStream from 'csv-reader';
import { URL } from 'url';
import https from 'https';

export type Rump = {
  speaker: string;
  description: string;
  title: string;
};

export type Participant = {
  email: string;
  displayName: string;
  qrCode: string;
};

export function assertExists<T>(value: T): asserts value is NonNullable<T> {
  if (value == null) {
    throw new Error('Env missing');
  }
}

export function assertIsString(value: unknown): asserts value is string {
  const isOfExpectedType = typeof value === 'string';

  if (!isOfExpectedType) {
    throw new Error('Missing string');
  }
}

export async function extractQRCode(filePath: string): Promise<string> {
  const configs = {
    scale: {
      once: true,
      value: 1,
    },
    resultOpts: {
      singleCodeInPage: true,
    },
    improve: true,
    jsQR: {},
  };

  return new Promise((resolve, reject) => {
    PDF_QR_JS.decodeSinglePage(
      filePath,
      1,
      configs,
      (result: { success?: string; message?: string; codes: string }) => {
        if (result.success) {
          resolve(result.codes[0]);
        } else {
          reject(result.message);
        }
      }
    );
  });
}

export async function extractParticipantsFromCsv(
  csvPath: string
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const participants: any[] = [];
    fs.createReadStream(csvPath, 'utf-8')
      .pipe(
        new CsvReadableStream({
          skipHeader: true,
          delimiter: ';',
          parseNumbers: true,
          parseBooleans: true,
          trim: true,
        })
      )
      .on('data', function (row: any) {
        participants.push(row);
      })
      .on('end', function () {
        resolve(participants);
      });
  });
}

export function ticketFilePathFromTicketUrl(ticketUrl: URL) {
  return `tickets/ticket_${ticketUrl.searchParams.get('ticketId')}.pdf`;
}

// 'tm5-HelloAsso=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.....'
export async function downloadTicket(ticketUrl: URL, cookie: string) {
  return new Promise((resolve, reject) => {
    const ticketFilePath = ticketFilePathFromTicketUrl(ticketUrl);
    const ticketFile = fs.createWriteStream(ticketFilePath);

    https.get(
      ticketUrl,
      {
        headers: {
          cookie,
        },
      },
      (response) => {
        response.pipe(ticketFile);
        ticketFile.on('finish', () => {
          ticketFile.close();
          resolve(ticketFilePath);
        });
      }
    );
  });
}
