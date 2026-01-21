import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

if (!process.env.SUPABASE_JWT_SECRET) {
  throw new Error("SUPABASE_JWT_SECRET is not set");
}

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export interface AuthRequest extends Request {
  user?: JwtPayload & {
    sub: string;
    email?: string;
    role?: string;
  };
}

export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing or invalid Authorization header",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
