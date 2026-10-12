import { supabase, isSupabaseConfigured, cleanRpcErrorMessage } from './supabase';

export type DeleteOrderResult = { ok: true } | { ok: false; error: string };

/**
 * Hide a finished order from this customer's OWN Orders list.
 *
 * This is a soft delete: `delete_customer_order()` re-checks, server-side,
 * that the caller owns the row and that the order is finished or cancelled,
 * then flips one column. The row itself — receipts, commission, settlement
 * and audit records — stays intact for the kitchen, the courier, support
 * and the Super Admin, because no DELETE policy is ever granted. The
 * database's own sentence is shown verbatim when it refuses.
 */
export async function deleteCustomerOrder(orderId: string): Promise<DeleteOrderResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Connect Supabase to manage your orders.' };
  }
  if (!orderId) return { ok: false, error: 'Missing order.' };

  const { error } = await supabase.rpc('delete_customer_order', { p_order_id: orderId });
  if (error) {
    return {
      ok: false,
      error: cleanRpcErrorMessage(error.message, 'Could not remove this order from your list.'),
    };
  }
  return { ok: true };
}
