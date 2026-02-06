const TOSS_API_URL = "https://api.tosspayments.com/v1/billing";

function getAuthHeader(): string {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) throw new Error("TOSS_SECRET_KEY is not configured");
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export interface IssueBillingKeyResponse {
  billingKey: string;
  customerKey: string;
  cardCompany: string;
  cardNumber: string;
  method: string;
}

export interface BillingPaymentResponse {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  status: string;
  method: string;
  approvedAt: string;
  card?: {
    company: string;
    number: string;
  };
  failure?: {
    code: string;
    message: string;
  };
}

/**
 * authKey를 이용해 billingKey 발급
 */
export async function issueBillingKey(
  authKey: string,
  customerKey: string
): Promise<IssueBillingKeyResponse> {
  const res = await fetch(`${TOSS_API_URL}/authorizations/issue`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ authKey, customerKey }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Failed to issue billing key: ${error.message || res.statusText}`);
  }

  return res.json();
}

/**
 * billingKey를 이용해 자동 결제
 */
export async function chargeBillingKey(
  billingKey: string,
  customerKey: string,
  orderId: string,
  amount: number,
  orderName: string
): Promise<BillingPaymentResponse> {
  const res = await fetch(`${TOSS_API_URL}/${billingKey}`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerKey,
      orderId,
      amount,
      orderName,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Payment failed: ${error.message || res.statusText}`);
  }

  return res.json();
}
