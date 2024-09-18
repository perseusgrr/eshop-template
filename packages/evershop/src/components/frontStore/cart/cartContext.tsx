import { produce } from 'immer';
import React, {
  createContext,
  useReducer,
  useContext,
  ReactNode,
  useCallback
} from 'react';
import { useQuery, useClient } from 'urql';
import { _ } from '../../../lib/locale/translate/_.js';
import { ApiResponse } from '../../../types/apiResponse.js';
import {
  CustomerAddressGraphql,
  Address
} from '../../../types/customerAddress.js';

const ShippingMethodsQuery = `
  query GetCartShippingMethods($country: String!, $province: String, $postcode: String) {
    myCart {
      availableShippingMethods(country: $country, province: $province, postcode: $postcode) {
        code
        name
        cost {
          value
          text
        }
      }
    }
  }
`;

export enum CartSyncTrigger {
  ADD_ITEM = 'addItem',
  REMOVE_ITEM = 'removeItem',
  UPDATE_ITEM = 'updateItem',
  ADD_PAYMENT_METHOD = 'addPaymentMethod',
  ADD_SHIPPING_METHOD = 'addShippingMethod',
  ADD_SHIPPING_ADDRESS = 'addShippingAddress',
  ADD_BILLING_ADDRESS = 'addBillingAddress',
  ADD_CONTACT_INFO = 'addContactInfo',
  APPLY_COUPON = 'applyCoupon',
  REMOVE_COUPON = 'removeCoupon'
}

export interface CartItem {
  cartItemId: string;
  qty: number;
  productSku: string;
  productName: string;
  productUrl: string;
  thumbnail?: string; // Added from GraphQL response
  variantOptions?: {
    attributeCode: string;
    attributeName: string;
    attributeId: number;
    optionId: number;
    optionText: string;
  }[]; // Changed from 'string' to match GraphQL response
  productPrice: {
    value: number;
    text: string;
  };
  productPriceInclTax: {
    value: number;
    text: string;
  };
  finalPrice: {
    value: number;
    text: string;
  };
  finalPriceInclTax: {
    value: number;
    text: string;
  };
  lineTotal: {
    value: number;
    text: string;
  };
  lineTotalInclTax: {
    value: number;
    text: string;
  };
  removeApi: string; // API endpoint to remove item from cart
  updateQtyApi: string; // API endpoint to update item quantity
  errors?: any[]; // Added from GraphQL response
  virtual?: boolean; // Virtual products don't require shipping
}

export interface PaymentMethod {
  id: string;
  name: string;
  code: string;
}

export interface ShippingMethod {
  id: string;
  name: string;
  code: string;
  price: number;
}

export interface ShippingAddressParams {
  country: string;
  province?: string;
  postcode?: string;
}

export interface CartError {
  field?: string;
  message: string;
  code?: string;
}

// Extensible cart data interface - third-party extensions can add any fields from server-side cart data
export interface CartData {
  uuid?: string; // Cart unique identifier (changed from 'id' to match GraphQL)
  totalQty: number; // Changed from 'totalItems' to match GraphQL
  customerId?: number; // Optional customer ID
  customerGroupId?: number; // Optional customer group ID
  customerEmail?: string; // Optional customer email
  customerFullName?: string; // Optional customer full name
  coupon?: string; // Coupon code applied to cart
  shippingMethod?: string; // Selected shipping method ID
  shippingMethodName?: string; // Selected shipping method name
  paymentMethod?: string; // Selected payment method ID
  paymentMethodName?: string; // Selected payment method name
  currency: string; // Currency code
  shippingNote?: string; // Shipping note
  addItemApi: string; // API endpoint to add item to cart
  addPaymentMethodApi: string; // API endpoint to add payment method
  addShippingMethodApi: string; // API endpoint to add shipping method
  addContactInfoApi: string; // API endpoint to add contact info
  addAddressApi: string; // API endpoint to add address
  addNoteApi: string; // API endpoint to add note
  applyCouponApi: string; // API endpoint to apply coupon
  checkoutApi: string; // API endpoint to perform checkout
  removeCouponApi?: string; // API endpoint to remove coupon
  items: CartItem[];
  subTotal: {
    value: number;
    text: string;
  };
  subTotalInclTax: {
    value: number;
    text: string;
  };
  grandTotal: {
    value: number;
    text: string;
  };
  taxAmount: {
    value: number;
    text: string;
  };
  discountAmount: {
    value: number;
    text: string;
  };
  shippingFeeExclTax: {
    value: number;
    text: string;
  };
  shippingFeeInclTax: {
    value: number;
    text: string;
  };
  availablePaymentMethods: {
    code: string;
    name: string;
  }[]; // Available payment methods from GraphQL
  availableShippingMethods: {
    code: string;
    name: string;
    cost?: {
      value: number;
      text: string;
    };
  }[]; // Available shipping methods from GraphQL (requires country/province)
  billingAddress?: CustomerAddressGraphql;
  shippingAddress?: CustomerAddressGraphql;
  errors: CartError[];
  error: string | null;
  [extendedFields: string]: any; // Allow third-party extensions to add fields
}

// Complete cart state with detailed loading states
export interface CartState {
  data: CartData; // Cart data, can be undefined if not initialized
  loading: boolean; // Overall loading state (true if any operation is loading) - derived from loadingStates
  setting: {
    priceIncludingTax: boolean;
  };
  loadingStates: {
    addingItem: boolean;
    removingItem: string | null; // Item ID being removed, null if none
    updatingItem: string | null; // Item ID being updated, null if none
    addingPaymentMethod: boolean;
    addingShippingMethod: boolean;
    addingShippingAddress: boolean;
    addingBillingAddress: boolean;
    addingContactInfo: boolean;
    applyingCoupon: boolean;
    removingCoupon: boolean;
    fetchingShippingMethods: boolean; // New loading state for fetching shipping methods
  };
  syncStatus: {
    syncing: boolean; // Whether a sync operation is in progress
    synced: boolean; // Whether the last sync was successful
    trigger?: string; // The reason/trigger that caused the sync (can be internal enum or external string)
  };
}

// Action type for cart operations
type CartAction =
  | { type: 'SET_CART'; payload: Partial<CartData> }
  | {
      type: 'SET_SPECIFIC_LOADING';
      payload: {
        operation: keyof CartState['loadingStates'];
        loading: boolean;
        itemId?: string;
      };
    }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_ERROR' }
  | {
      type: 'SET_SYNC_STATUS';
      payload: { syncing?: boolean; synced?: boolean; trigger?: string };
    };

// The shape of the functions that will be returned by the useCartDispatch hook
interface CartDispatch {
  addItem: (payload: { sku: string; qty: number }) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateItem: (
    itemId: string,
    payload: { qty: number; action: 'increase' | 'decrease' }
  ) => Promise<void>;
  addPaymentMethod: (code: string, name: string) => Promise<void>;
  addShippingMethod: (code: string, name: string) => Promise<void>;
  addShippingAddress: (address: Address) => Promise<void>;
  addBillingAddress: (address: Address) => Promise<void>;
  addContactInfo: (contactInfo: { email: string }) => Promise<void>;
  applyCoupon: (couponCode: string) => Promise<void>;
  removeCoupon: () => Promise<void>;
  clearError: () => void;
  isShippingRequired: () => boolean;
  isReadyForCheckout: () => boolean;
  getErrors: () => CartError[];
  getId: () => string | null;
  fetchAvailableShippingMethods: (
    params: ShippingAddressParams
  ) => Promise<void>;
  syncCartWithServer: (trigger?: string) => Promise<void>; // Added trigger parameter
}

// --- INITIAL STATE ---

// Simple reducer with detailed loading states
const cartReducer = (state: CartState, action: CartAction): CartState => {
  return produce(state, (draft) => {
    switch (action.type) {
      case 'SET_CART':
        if (draft.data) {
          Object.assign(draft.data, action.payload);
          draft.data.error = null;
        } else {
          draft.data = action.payload as CartData;
        }
        // Clear all loading states when cart is set
        draft.loadingStates = {
          addingItem: false,
          removingItem: null,
          updatingItem: null,
          addingPaymentMethod: false,
          addingShippingMethod: false,
          addingShippingAddress: false,
          addingBillingAddress: false,
          addingContactInfo: false,
          applyingCoupon: false,
          removingCoupon: false,
          fetchingShippingMethods: false
        };
        draft.loading = false;
        break;

      case 'SET_SPECIFIC_LOADING':
        const { operation, loading, itemId } = action.payload;
        if (operation === 'removingItem' || operation === 'updatingItem') {
          draft.loadingStates[operation] = loading ? itemId || null : null;
        } else {
          (draft.loadingStates as any)[operation] = loading;
        }
        // Update overall loading state based on loadingStates
        draft.loading = Object.values(draft.loadingStates).some(
          (state) =>
            state === true || (typeof state === 'string' && state !== null)
        );
        break;

      case 'SET_ERROR':
        if (draft.data) {
          draft.data.error = action.payload;
        }
        // Clear all loading states on error
        draft.loadingStates = {
          addingItem: false,
          removingItem: null,
          updatingItem: null,
          addingPaymentMethod: false,
          addingShippingMethod: false,
          addingShippingAddress: false,
          addingBillingAddress: false,
          addingContactInfo: false,
          applyingCoupon: false,
          removingCoupon: false,
          fetchingShippingMethods: false
        };
        draft.loading = false;
        break;

      case 'CLEAR_ERROR':
        if (draft.data) {
          draft.data.error = null;
          draft.data.errors = [];
        }
        break;

      case 'SET_SYNC_STATUS':
        Object.assign(draft.syncStatus, action.payload);
        break;
    }
  });
}; // --- CONTEXT DEFINITION ---

const CartStateContext = createContext<CartState | undefined>(undefined);
const CartDispatchContext = createContext<CartDispatch | undefined>(undefined);

interface CartProviderProps {
  children: ReactNode;
  query: string;
  cart?: CartData;
  setting: {
    priceIncludingTax: boolean;
  };
  addMineCartItemApi: string;
}

export const CartProvider = ({
  children,
  query,
  cart,
  setting,
  addMineCartItemApi
}: CartProviderProps) => {
  const client = useClient(); // Get urql client for GraphQL queries

  const hydratedInitialState: CartState = {
    data: cart
      ? cart
      : {
          currency: 'USD',
          items: [],
          totalQty: 0,
          billingAddress: undefined,
          shippingAddress: undefined,
          errors: [],
          error: null,
          subTotal: { value: 0, text: '0.00' },
          subTotalInclTax: { value: 0, text: '0.00' },
          shippingFeeExclTax: { value: 0, text: '0.00' },
          shippingFeeInclTax: { value: 0, text: '0.00' },
          grandTotal: { value: 0, text: '0.00' },
          taxAmount: { value: 0, text: '0.00' },
          discountAmount: { value: 0, text: '0.00' },
          coupon: '',
          addItemApi: addMineCartItemApi, // API endpoint to add items to cart
          addPaymentMethodApi: '', // Will be set by server
          addShippingMethodApi: '', // Will be set by server
          addAddressApi: '', // Will be set by server
          applyCouponApi: '', // Will be set by server
          addNoteApi: '', // Will be set by server
          addContactInfoApi: '', // Will be set by server
          checkoutApi: '', // Will be set by server
          availablePaymentMethods: [],
          availableShippingMethods: []
        },
    loading: false,
    loadingStates: {
      addingItem: false,
      removingItem: null,
      updatingItem: null,
      addingPaymentMethod: false,
      addingShippingMethod: false,
      addingShippingAddress: false,
      addingBillingAddress: false,
      addingContactInfo: false,
      applyingCoupon: false,
      removingCoupon: false,
      fetchingShippingMethods: false
    },
    syncStatus: {
      syncing: false,
      synced: false,
      trigger: undefined
    },
    setting: { priceIncludingTax: false }
  };

  const [state, dispatch] = useReducer(cartReducer, hydratedInitialState);

  // Use urql to query cart data
  const [cartQueryResult, refetchCart] = useQuery({
    query: query,
    pause: !state.data?.uuid // Only query if we have a cart UUID
  });

  // --- UTILITY FUNCTIONS ---

  const retry = async function <T>(
    fn: () => Promise<T>,
    retries = 2,
    delay = 1000
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return retry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  };

  const syncCartWithServer = useCallback(
    async (trigger?: string): Promise<void> => {
      try {
        // Set syncing to true and synced to false when starting sync
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: { syncing: true, synced: false, trigger }
        });

        await refetchCart({ requestPolicy: 'network-only' });

        // Set syncing to false and synced to true on success
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: { syncing: false, synced: true, trigger }
        });
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error ? error.message : 'Failed to sync cart'
        });

        // Set syncing to false and keep synced as false on error
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: { syncing: false, synced: false, trigger }
        });
      }
    },
    [refetchCart]
  );

  // Effect to update cart when GraphQL query result changes
  React.useEffect(() => {
    if (cartQueryResult.data?.myCart) {
      const serverCart = cartQueryResult.data.myCart;
      dispatch({
        type: 'SET_CART',
        payload: serverCart
      });
    }
  }, [cartQueryResult.data]);

  React.useEffect(() => {
    if (cart && JSON.stringify(cart) !== JSON.stringify(state.data)) {
      dispatch({ type: 'SET_CART', payload: cart });
    }
  }, [cart]);

  const addItem = useCallback(
    async (payload: { sku: string; qty: number }) => {
      if (!state.data) {
        throw new Error('Cannot add item: cart not initialized');
      }

      try {
        // Set specific loading state
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingItem', loading: true }
        });

        // Server request with retry
        const response = await retry(() =>
          fetch(state.data!.addItemApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        );

        const json = (await response.json()) as ApiResponse<CartData>;

        if (!response.ok) {
          throw new Error(json.error?.message || 'Failed to add item.');
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.ADD_ITEM);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload: error instanceof Error ? error.message : 'Failed to add item'
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingItem', loading: false }
        });
      }
    },
    [state.data?.addItemApi, syncCartWithServer]
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (!state.data) {
        throw new Error('Cannot remove item: cart not initialized');
      }

      const item = state.data.items.find((item) => item.cartItemId === itemId);
      if (!item) {
        throw new Error('Item not found in cart');
      }

      try {
        // Set specific loading state for this item
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'removingItem', loading: true, itemId }
        });

        // Server request with retry using item's remove API
        const response = await retry(() =>
          fetch(item.removeApi, {
            method: 'DELETE'
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json.error?.message || 'Failed to remove item.');
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.REMOVE_ITEM);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error ? error.message : 'Failed to remove item'
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'removingItem', loading: false }
        });
      }
    },
    [state, syncCartWithServer]
  );

  const updateItem = useCallback(
    async (
      itemId: string,
      payload: { qty: number; action: 'increase' | 'decrease' }
    ) => {
      if (!state.data) {
        throw new Error('Cannot update item: cart not initialized');
      }

      const item = state.data.items.find((item) => item.cartItemId === itemId);
      if (!item) {
        throw new Error('Item not found in cart');
      }

      try {
        // Set specific loading state for this item
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'updatingItem', loading: true, itemId }
        });

        // Server request with retry using item's update API
        const response = await retry(() =>
          fetch(item.updateQtyApi, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json.error?.message || 'Failed to update item.');
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.UPDATE_ITEM);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error ? error.message : 'Failed to update item'
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'updatingItem', loading: false }
        });
      }
    },
    [state, syncCartWithServer]
  );

  // Clear error function
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  // Add payment method
  const addPaymentMethod = useCallback(
    async (code: string, name: string) => {
      if (!state.data) {
        throw new Error(_('Cannot add payment method: cart not initialized'));
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingPaymentMethod', loading: true }
        });

        const response = await retry(() =>
          fetch(state.data!.addPaymentMethodApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method_code: code, method_name: name })
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(
            json.error?.message || _('Failed to add payment method.')
          );
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.ADD_PAYMENT_METHOD);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error
              ? error.message
              : _('Failed to add payment method')
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingPaymentMethod', loading: false }
        });
      }
    },
    [state.data?.addPaymentMethodApi, syncCartWithServer]
  );

  // Add shipping method
  const addShippingMethod = useCallback(
    async (code: string, name: string) => {
      if (!state.data) {
        throw new Error(_('Cannot add shipping method: cart not initialized'));
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingShippingMethod', loading: true }
        });

        const response = await retry(() =>
          fetch(state.data!.addShippingMethodApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method_code: code, method_name: name })
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(
            json.error?.message || _('Failed to add shipping method.')
          );
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.ADD_SHIPPING_METHOD);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error
              ? error.message
              : _('Failed to add shipping method')
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingShippingMethod', loading: false }
        });
      }
    },
    [state.data?.addShippingMethodApi, syncCartWithServer]
  );

  // Add shipping address
  const addShippingAddress = useCallback(
    async (address: Address) => {
      if (!state.data) {
        throw new Error(_('Cannot add shipping address: cart not initialized'));
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingShippingAddress', loading: true }
        });

        const response = await retry(() =>
          fetch(state.data!.addAddressApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: { ...address }, type: 'shipping' })
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(
            json.error?.message || _('Failed to add shipping address.')
          );
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.ADD_SHIPPING_ADDRESS);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error
              ? error.message
              : _('Failed to add shipping address')
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingShippingAddress', loading: false }
        });
      }
    },
    [state.data?.addAddressApi, syncCartWithServer]
  );

  // Add billing address
  const addBillingAddress = useCallback(
    async (address: Address) => {
      if (!state.data) {
        throw new Error(_('Cannot add billing address: cart not initialized'));
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingBillingAddress', loading: true }
        });

        const response = await retry(() =>
          fetch(state.data!.addAddressApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: { ...address }, type: 'billing' })
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(
            json.error?.message || _('Failed to add billing address.')
          );
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.ADD_BILLING_ADDRESS);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error
              ? error.message
              : _('Failed to add billing address')
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingBillingAddress', loading: false }
        });
      }
    },
    [state.data?.addAddressApi, syncCartWithServer]
  );

  // Add contact info
  const addContactInfo = useCallback(
    async (contactInfo: { email: string }) => {
      if (!state.data) {
        throw new Error(_('Cannot add contact info: cart not initialized'));
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingContactInfo', loading: true }
        });

        const response = await retry(() =>
          fetch(state.data!.addContactInfoApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(contactInfo)
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(
            json.error?.message || _('Failed to add contact info.')
          );
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.ADD_CONTACT_INFO);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error
              ? error.message
              : _('Failed to add contact info')
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'addingContactInfo', loading: false }
        });
      }
    },
    [state.data?.addContactInfoApi, syncCartWithServer]
  );

  // Apply coupon
  const applyCoupon = useCallback(
    async (couponCode: string) => {
      if (!state.data) {
        throw new Error(_('Cannot apply coupon: cart not initialized'));
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'applyingCoupon', loading: true }
        });

        const response = await retry(() =>
          fetch(state.data!.applyCouponApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coupon: couponCode })
          })
        );

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json.error?.message || 'Failed to apply coupon.');
        }

        // Sync with server (both immediate update and GraphQL refetch)
        await syncCartWithServer(CartSyncTrigger.APPLY_COUPON);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload:
            error instanceof Error ? error.message : 'Failed to apply coupon'
        });
        throw error;
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'applyingCoupon', loading: false }
        });
      }
    },
    [state.data?.applyCouponApi, syncCartWithServer]
  );

  // Remove coupon
  const removeCoupon = useCallback(async () => {
    if (!state.data) {
      throw new Error(_('Cannot remove coupon: cart not initialized'));
    }
    if (!state.data?.removeCouponApi) {
      throw new Error(_('No coupon to remove'));
    }

    try {
      dispatch({
        type: 'SET_SPECIFIC_LOADING',
        payload: { operation: 'removingCoupon', loading: true }
      });

      const response = await retry(() =>
        fetch(state.data!.removeCouponApi as string, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || _('Failed to remove coupon.'));
      }

      // Sync with server (both immediate update and GraphQL refetch)
      await syncCartWithServer(CartSyncTrigger.REMOVE_COUPON);
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload:
          error instanceof Error ? error.message : _('Failed to remove coupon')
      });
      throw error;
    } finally {
      dispatch({
        type: 'SET_SPECIFIC_LOADING',
        payload: { operation: 'removingCoupon', loading: false }
      });
    }
  }, [state.data?.removeCouponApi, syncCartWithServer]);

  // Check if shipping is required
  const isShippingRequired = useCallback(() => {
    if (!state.data) return false;
    return state.data.items.some((item) => !item.virtual);
  }, [state.data?.items]);

  // Check if cart is ready for checkout
  const isReadyForCheckout = useCallback(() => {
    if (!state.data) return false;

    const hasItems = state.data.items.length > 0;
    const hasBillingAddress = !!state.data.billingAddress;
    const hasShippingAddress =
      !isShippingRequired() || !!state.data.shippingAddress;
    const noErrors = state.data.errors.length === 0;

    return hasItems && hasBillingAddress && hasShippingAddress && noErrors;
  }, [state.data, isShippingRequired]);

  // Get validation errors
  const getErrors = useCallback(() => {
    return state.data?.errors ?? [];
  }, [state.data?.errors]);

  // Get cart ID
  const getId = useCallback(() => {
    return state.data?.uuid ?? null;
  }, [state.data?.uuid]);

  // Fetch available shipping methods based on address parameters and update cart state
  const fetchAvailableShippingMethods = useCallback(
    async (params: ShippingAddressParams) => {
      if (!state.data?.uuid) {
        throw new Error('Cannot fetch shipping methods: cart not initialized');
      }

      try {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'fetchingShippingMethods', loading: true }
        });

        const result = await client
          .query(ShippingMethodsQuery, {
            country: params.country,
            province: params.province || null,
            postcode: params.postcode || null
          })
          .toPromise();

        if (result.error) {
          throw new Error(
            result.error.message || 'Failed to fetch shipping methods'
          );
        }

        // Update cart state with new shipping methods
        if (result.data?.myCart?.availableShippingMethods) {
          dispatch({
            type: 'SET_CART',
            payload: {
              availableShippingMethods:
                result.data.myCart.availableShippingMethods
            }
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Failed to fetch shipping methods';

        dispatch({
          type: 'SET_ERROR',
          payload: errorMessage
        });

        throw new Error(errorMessage);
      } finally {
        dispatch({
          type: 'SET_SPECIFIC_LOADING',
          payload: { operation: 'fetchingShippingMethods', loading: false }
        });
      }
    },
    [state.data?.uuid, client]
  );

  const cartDispatch: CartDispatch = {
    addItem,
    removeItem,
    updateItem,
    addPaymentMethod,
    addShippingMethod,
    addShippingAddress,
    addBillingAddress,
    addContactInfo,
    applyCoupon,
    removeCoupon,
    clearError,
    isShippingRequired,
    isReadyForCheckout,
    getErrors,
    getId,
    fetchAvailableShippingMethods,
    syncCartWithServer
  };

  return (
    <CartStateContext.Provider value={state}>
      <CartDispatchContext.Provider value={cartDispatch}>
        {children}
      </CartDispatchContext.Provider>
    </CartStateContext.Provider>
  );
};

// --- CUSTOM HOOKS ---

export const useCartState = (): CartState => {
  const context = useContext(CartStateContext);
  if (context === undefined) {
    throw new Error('useCartState must be used within a CartProvider');
  }
  return context;
};

export const useCartDispatch = (): CartDispatch => {
  const context = useContext(CartDispatchContext);
  if (context === undefined) {
    throw new Error('useCartDispatch must be used within a CartProvider');
  }
  return context;
};
