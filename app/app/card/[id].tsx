import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TicketPage, fromOf } from '../../src/components/ticket';

/** One card, opened: the ticket page (HANDOVER §4.4, `components/ticket.tsx
 *  TicketPage`). The card is named by its own id and the machine it is on, and
 *  `from` says which screen opened it, which is where Back leads when there is
 *  no screen under this one. */
export default function CardScreen() {
  const params = useLocalSearchParams<{ id?: string; host?: string; from?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  return <TicketPage id={one(params.id) ?? ''} host={one(params.host)} from={fromOf(one(params.from))} />;
}
