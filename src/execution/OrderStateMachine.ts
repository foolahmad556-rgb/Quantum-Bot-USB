/**
 * Basel Quantum Algorithmic Trading System
 * Order Lifecycle Finite State Machine (FSM)
 */

import { Order, OrderStatus } from '../domain/types';

export interface StateTransitionEvent {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  timestamp: number;
  reason?: string;
}

export class OrderStateMachine {
  // Valid status transitions
  private static readonly VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    PENDING_NEW: ['NEW', 'REJECTED', 'CANCELLED'],
    NEW: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'],
    PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'],
    FILLED: [], // Terminal
    CANCELLED: [], // Terminal
    REJECTED: [], // Terminal
    EXPIRED: [], // Terminal
  };

  private history: StateTransitionEvent[] = [];

  public canTransition(currentStatus: OrderStatus, newStatus: OrderStatus): boolean {
    const allowed = OrderStateMachine.VALID_TRANSITIONS[currentStatus] || [];
    return allowed.includes(newStatus);
  }

  public transition(order: Order, newStatus: OrderStatus, reason?: string): Order {
    if (order.status === newStatus) return order;

    if (!this.canTransition(order.status, newStatus)) {
      throw new Error(`Illegal order state transition from ${order.status} to ${newStatus} for order ${order.id}`);
    }

    const orderCopy = { ...order, status: newStatus, updatedAt: Date.now() };
    const fromStatus = order.status;
    if (reason) orderCopy.errorMessage = reason;

    const event: StateTransitionEvent = {
      orderId: orderCopy.id,
      fromStatus,
      toStatus: newStatus,
      timestamp: Date.now(),
      reason,
    };

    this.history.unshift(event);
    if (this.history.length > 200) this.history.pop();

    return orderCopy;
  }

  public getHistory(): StateTransitionEvent[] {
    return [...this.history];
  }
}
