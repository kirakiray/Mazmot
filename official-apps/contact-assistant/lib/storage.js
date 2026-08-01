import { EverCache } from "/gh/kirakiray/ever-cache/src/main.min.js";

export const cache = new EverCache("contact-assistant");

const SPACES_KEY = "spaces";

function spaceKey(id) {
  return `space:${id}`;
}

function contactsKey(spaceId) {
  return `contacts:${spaceId}`;
}

function messagesKey(spaceId, visitorId) {
  return `messages:${spaceId}:${visitorId}`;
}

function visitorSpaceKey(spaceId) {
  return `visitor-space:${spaceId}`;
}

function visitorMessagesKey(spaceId) {
  return `visitor-messages:${spaceId}`;
}

export async function getSpaces() {
  try {
    return (await cache.getItem(SPACES_KEY)) || [];
  } catch (err) {
    console.error("getSpaces error:", err);
    return [];
  }
}

export async function saveSpace(space) {
  try {
    const spaces = await getSpaces();
    const idx = spaces.findIndex((s) => s.id === space.id);
    if (idx >= 0) {
      spaces[idx] = space;
    } else {
      spaces.push(space);
    }
    await cache.setItem(SPACES_KEY, spaces);
    await cache.setItem(spaceKey(space.id), space);
    return true;
  } catch (err) {
    console.error("saveSpace error:", err);
    return false;
  }
}

export async function getSpace(id) {
  try {
    return (
      (await cache.getItem(spaceKey(id))) ||
      (await getSpaces()).find((s) => s.id === id) ||
      null
    );
  } catch (err) {
    console.error("getSpace error:", err);
    return null;
  }
}

export async function deleteSpace(id) {
  try {
    const spaces = (await getSpaces()).filter((s) => s.id !== id);
    await cache.setItem(SPACES_KEY, spaces);
    await cache.removeItem(spaceKey(id));
    return true;
  } catch (err) {
    console.error("deleteSpace error:", err);
    return false;
  }
}

export async function getContacts(spaceId) {
  try {
    return (await cache.getItem(contactsKey(spaceId))) || [];
  } catch (err) {
    console.error("getContacts error:", err);
    return [];
  }
}

export async function updateContact(spaceId, contact) {
  try {
    const contacts = await getContacts(spaceId);
    const idx = contacts.findIndex((c) => c.visitorId === contact.visitorId);
    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], ...contact };
    } else {
      contacts.push(contact);
    }
    contacts.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    await cache.setItem(contactsKey(spaceId), contacts);
    return contacts[idx] || contact;
  } catch (err) {
    console.error("updateContact error:", err);
    return contact;
  }
}

export async function getMessages(spaceId, visitorId) {
  try {
    return (await cache.getItem(messagesKey(spaceId, visitorId))) || [];
  } catch (err) {
    console.error("getMessages error:", err);
    return [];
  }
}

export async function addMessage(spaceId, visitorId, message) {
  try {
    const messages = await getMessages(spaceId, visitorId);
    messages.push(message);
    await cache.setItem(messagesKey(spaceId, visitorId), messages);
    return message;
  } catch (err) {
    console.error("addMessage error:", err);
    return message;
  }
}

export async function getVisitorSpace(spaceId) {
  try {
    return (await cache.getItem(visitorSpaceKey(spaceId))) || null;
  } catch (err) {
    console.error("getVisitorSpace error:", err);
    return null;
  }
}

export async function saveVisitorSpace(spaceId, data) {
  try {
    await cache.setItem(visitorSpaceKey(spaceId), data);
    return true;
  } catch (err) {
    console.error("saveVisitorSpace error:", err);
    return false;
  }
}

export async function getVisitorMessages(spaceId) {
  try {
    return (await cache.getItem(visitorMessagesKey(spaceId))) || [];
  } catch (err) {
    console.error("getVisitorMessages error:", err);
    return [];
  }
}

export async function addVisitorMessage(spaceId, message) {
  try {
    const messages = await getVisitorMessages(spaceId);
    messages.push(message);
    await cache.setItem(visitorMessagesKey(spaceId), messages);
    return message;
  } catch (err) {
    console.error("addVisitorMessage error:", err);
    return message;
  }
}
