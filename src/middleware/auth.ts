import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("SUPABASE_JWT_SECRET is not set");
}

export interface SupabaseUser extends JwtPayload {
  sub: string;
  email?: string;
  role?: string;
}

export interface AuthRequest extends Request {
  user?: SupabaseUser;
}

export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SupabaseUser;

    if (!decoded.sub) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
