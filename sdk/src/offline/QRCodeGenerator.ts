import QRCode from "qrcode";
import { PaymentIntentData, encodeQRPayload } from "./PaymentIntent";

/**
 * Generates a QR code data URL from a payment intent.
 */
export async function generatePaymentQR(
  intent: PaymentIntentData,
  signature: string,
  options?: QRCode.QRCodeToDataURLOptions
): Promise<string> {
  const payload = encodeQRPayload(intent, signature);
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    width: 400,
    margin: 2,
    ...options,
  });
}

/**
 * Generates a QR code as an SVG string.
 */
export async function generatePaymentQRSvg(
  intent: PaymentIntentData,
  signature: string
): Promise<string> {
  const payload = encodeQRPayload(intent, signature);
  return QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M" });
}
