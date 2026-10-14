import { createHmac } from "node:crypto";

export interface PaystackInitParams {
  email: string;
  amountInCents: number;
  currency?: string;
  spaceId: string;
  planId: string;
  callbackUrl?: string;
}

export interface PaystackInitResponse {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackVerifyResponse {
  success: boolean;
  reference: string;
  amount: number;
  currency: string;
  customerEmail: string;
  spaceId?: string;
  planId?: string;
}
const DEFAULT_SECRET_KEY = "";

/** Default exchange rate: 1 USD = 130 KES (can be overridden via USD_TO_KES_RATE env var) */
export const DEFAULT_USD_TO_KES_RATE = 130;

export function getUsdToKesRate(): number {
  const envVal = Number(process.env.USD_TO_KES_RATE);
  return envVal && !isNaN(envVal) && envVal > 0 ? envVal : DEFAULT_USD_TO_KES_RATE;
}

/** Plan USD base pricing: Pro $9/mo ($89/yr), Lifetime $129 */
export const PLAN_PRICING_USD: Record<string, number> = {
  pro_monthly: 9,
  monthly: 9,
  pro_annual: 89,
  annual: 89,
  pro_lifetime: 129,
  lifetime: 129,
};

export interface PlanConversion {
  planId: string;
  usdPrice: number;
  kesPrice: number;
  kesSubunits: number; // 100 cents = 1 KES
  exchangeRate: number;
  currency: "KES";
}

/** Converts USD plan price to KES for processing */
export function convertPlanPrice(planId: string): PlanConversion {
  const usdPrice = PLAN_PRICING_USD[planId] ?? 9;
  const rate = getUsdToKesRate();
  const kesSubunits = Math.max(100, Math.round(usdPrice * rate * 100));
  const kesPrice = Number((kesSubunits / 100).toFixed(2));
  return {
    planId,
    usdPrice,
    kesPrice,
    kesSubunits,
    exchangeRate: rate,
    currency: "KES",
  };
}

export function getPaystackSecretKey(): string {
  return process.env.PAYSTACK_SECRET_KEY || DEFAULT_SECRET_KEY;
}

/** Initialize a checkout transaction on Paystack */
export async function initializePaystackTransaction(params: PaystackInitParams): Promise<PaystackInitResponse> {
  const secretKey = getPaystackSecretKey();
  const currency = params.currency || "KES";
  const rate = getUsdToKesRate();

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountInCents,
      currency,
      callback_url: params.callbackUrl,
      metadata: {
        spaceId: params.spaceId,
        planId: params.planId,
        exchangeRate: rate,
        settlementCurrency: currency,
        custom_fields: [
          { display_name: "Space ID", variable_name: "space_id", value: params.spaceId },
          { display_name: "Plan", variable_name: "plan_id", value: params.planId },
          { display_name: "Currency", variable_name: "currency", value: currency },
        ],
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Paystack initialize failed: ${errorText}`);
  }

  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: { authorization_url: string; access_code: string; reference: string };
  };

  if (!json.status || !json.data?.authorization_url) {
    throw new Error(json.message || "Paystack initialization failed");
  }

  return {
    authorizationUrl: json.data.authorization_url,
    accessCode: json.data.access_code,
    reference: json.data.reference,
  };
}

/** Verify a completed transaction by reference */
export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyResponse> {
  const secretKey = getPaystackSecretKey();

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Paystack verify failed: ${errorText}`);
  }

  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: {
      status: string;
      reference: string;
      amount: number;
      currency: string;
      customer?: { email: string };
      metadata?: { spaceId?: string; planId?: string };
    };
  };

  if (!json.status || json.data.status !== "success") {
    return {
      success: false,
      reference,
      amount: json.data?.amount ?? 0,
      currency: json.data?.currency ?? "USD",
      customerEmail: json.data?.customer?.email ?? "",
    };
  }

  return {
    success: true,
    reference: json.data.reference,
    amount: json.data.amount,
    currency: json.data.currency,
    customerEmail: json.data.customer?.email ?? "",
    spaceId: json.data.metadata?.spaceId,
    planId: json.data.metadata?.planId,
  };
}

/** Validate Paystack webhook signature using HMAC SHA512 */
export function verifyPaystackWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const secretKey = getPaystackSecretKey();
  const hash = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return hash === signature;
}
