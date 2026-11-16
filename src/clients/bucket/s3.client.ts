import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import { config } from '../../core/config';
import { ExpenseRejectedError, RetryLaterError } from '../../core/errors';

const CONNECTION_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;

const client = new S3Client({
  region: config.STORAGE_REGION,
  credentials: {
    accessKeyId: config.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
  },
  requestHandler: { connectionTimeout: CONNECTION_TIMEOUT_MS },
});

export async function downloadReceipt(
  organizationId: string,
  expenseId: string,
  receiptId: string,
): Promise<Buffer> {
  const key = `org/${organizationId}/expenses/${expenseId}/${receiptId}`;
  try {
    const { Body } = await client.send(
      new GetObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) },
    );
    return Buffer.from(await Body!.transformToByteArray());
  } catch (error) {
    if (error instanceof NoSuchKey) {
      throw new ExpenseRejectedError('RECEIPT_NOT_FOUND', `The receipt ${receiptId} is not in S3`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new RetryLaterError('STORAGE_UNAVAILABLE', `S3 could not be read: ${reason}`);
  }
}
