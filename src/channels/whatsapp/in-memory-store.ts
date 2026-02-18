/**
 * Lightweight in-memory store for Baileys.
 *
 * The third-party package @naanzitos/baileys-make-in-memory-store relies on a
 * postinstall injection into the Baileys package directory, which fails under
 * pnpm's strict module isolation. This local implementation provides the same
 * core functionality (message/chat/contact caching) with zero external deps.
 */

import type { BaileysEventEmitter } from '@whiskeysockets/baileys';

export interface StoreConfig {
    logger?: any;
}

export function makeInMemoryStore(config?: StoreConfig) {
    const chats = new Map<string, any>();
    const contacts = new Map<string, any>();
    const messages = new Map<string, any[]>();
    const groupMetadata = new Map<string, any>();

    const bind = (ev: BaileysEventEmitter) => {
        ev.on('messaging-history.set', ({ chats: newChats, contacts: newContacts, messages: newMessages }) => {
            for (const chat of newChats) {
                chats.set(chat.id as string, chat);
            }
            for (const contact of newContacts) {
                contacts.set(contact.id, contact);
            }
            for (const msg of newMessages) {
                const jid = msg.key?.remoteJid;
                if (jid) {
                    if (!messages.has(jid)) messages.set(jid, []);
                    messages.get(jid)!.push(msg);
                }
            }
        });

        ev.on('contacts.upsert', (newContacts: any[]) => {
            for (const contact of newContacts) {
                contacts.set(contact.id, { ...contacts.get(contact.id), ...contact });
            }
        });

        ev.on('chats.upsert', (newChats: any[]) => {
            for (const chat of newChats) {
                chats.set(chat.id, { ...chats.get(chat.id), ...chat });
            }
        });

        ev.on('chats.update', (updates: any[]) => {
            for (const update of updates) {
                const existing = chats.get(update.id);
                if (existing) {
                    Object.assign(existing, update);
                }
            }
        });

        ev.on('chats.delete', (ids: string[]) => {
            for (const id of ids) {
                chats.delete(id);
            }
        });

        ev.on('messages.upsert', ({ messages: newMessages }: any) => {
            for (const msg of newMessages) {
                const jid = msg.key?.remoteJid;
                if (jid) {
                    if (!messages.has(jid)) messages.set(jid, []);
                    messages.get(jid)!.push(msg);
                }
            }
        });

        ev.on('messages.update', (updates: any[]) => {
            for (const { key, update } of updates) {
                const list = messages.get(key.remoteJid);
                if (list) {
                    const idx = list.findIndex((m: any) => m.key.id === key.id);
                    if (idx >= 0) Object.assign(list[idx], update);
                }
            }
        });

        ev.on('groups.update', (updates: any[]) => {
            for (const update of updates) {
                const existing = groupMetadata.get(update.id);
                if (existing) {
                    Object.assign(existing, update);
                }
            }
        });
    };

    return {
        chats,
        contacts,
        messages,
        groupMetadata,
        bind,
        loadMessage: async (jid: string, id: string) => {
            return messages.get(jid)?.find((m: any) => m.key.id === id);
        },
    };
}
