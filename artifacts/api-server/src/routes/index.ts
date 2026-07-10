import { Router } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import productsRouter from "./products";
import ordersRouter from "./orders";
import customersRouter from "./customers";
import dropsRouter from "./drops";
import analyticsRouter from "./analytics";
import integrationsRouter from "./integrations";
import logoRouter from "./logo";
import mockupRouter from "./mockup";
import photographyRouter from "./photography";
import bgRemovalRouter from "./bg-removal";
import lifestyleRouter from "./lifestyle";

const router = Router();

router.use("/healthz",     healthRouter);
router.use("/auth",        authRouter);
router.use("/products",    productsRouter);
router.use("/orders",      ordersRouter);
router.use("/customers",   customersRouter);
router.use("/drops",       dropsRouter);
router.use("/analytics",   analyticsRouter);
router.use("/integrations", integrationsRouter);
router.use("/logo",         logoRouter);
router.use("/mockup",       mockupRouter);
router.use("/photography",  photographyRouter);
router.use("/bg-removal",   bgRemovalRouter);
router.use("/lifestyle",    lifestyleRouter);

export default router;
