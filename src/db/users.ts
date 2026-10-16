import { db } from './index.ts';
import { users } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function getOrCreateUser(email: string, passwordHash?: string) {
  try {
    const result = await db.insert(users)
      .values({
        email,
        passwordHash: passwordHash || '',
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Error in getOrCreateUser:", error);
    throw new Error("Failed to synchronize user with database.");
  }
}

export async function getUserByEmail(email: string) {
  try {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error("Error in getUserByEmail:", error);
    throw new Error("Failed to fetch user from database.");
  }
}
