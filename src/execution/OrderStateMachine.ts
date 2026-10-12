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
  // REJECTED is allowed from any non-terminal state — an exchange can reject an
  // order at any point before it reaches a terminal state.
  private static readonly TERMINAL_STATES: OrderStatus[] = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'];

  private static readonly VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    PENDING_NEW: ['NEW', 'REJECTED', 'CANCELLED'],
    NEW: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'],
    PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'],
    FILLED: [], // Terminal
    CANCELLED: [], // Terminal
    REJECTED: [], // Terminal
    EXPIRED: [], // Terminal
  };

  private history: StateTransitionEvent[] = [];

  public canTransition(currentStatus: OrderStatus, newStatus: OrderStatus): boolean {
    if (currentStatus === newStatus) return true;
    const allowed = OrderStateMachine.VALID_TRANSITIONS[currentStatus] || [];
    return allowed.includes(newStatus);
  }

  public transition(order: Order, newStatus: OrderStatus, reason?: string): Order {
    if (order.status === newStatus) return order;

    if (!this.canTransition(order.status, newStatus)) {
      throw new Error(`Illegal order state transition from ${order.status} to ${newStatus} for order ${order.id}`);
    }

    const fromStatus = order.status;

    // Return a NEW Order object — do NOT mutate the input parameter.
    // Mutating shared Order instances causes race conditions when the same
    // Order is referenced across components or concurrent async paths.
    const updatedOrder: Order = {
      ...order,
      status: newStatus,
      updatedAt: Date.now(),
      errorMessage: reason || order.errorMessage,
    };

    const event: StateTransitionEvent = {
      orderId: order.id,
      fromStatus,
      toStatus: newStatus,
      timestamp: Date.now(),
      reason,
    };

    this.history.unshift(event);
    if (this.history.length > 200) this.history.pop();

    return updatedOrder;
  }

  public getHistory(): StateTransitionEvent[] {
    return [...this.history];
  }
}
