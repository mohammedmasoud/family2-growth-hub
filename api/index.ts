import express, { Express, Request, Response } from 'express';
import { router } from './routers'; // لو فيه راوترات جاهزة
import { db } from './db'; // لو فيه قاعدة بيانات

const app: Express = express();
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());

// جلب الراوترات من الملفات الموجودة (زي routers.ts)
app.use('/api', router);

// نقطة فحص بسيطة عشان تتأكد إن السيرفر شغال
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Server is running!' });
});

// لو عايز تشغل السيرفر محلياً (Vercel مش محتاجها، لكن للاحتياط)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

// التصدير لـ Vercel (الحاجة الأهم)
export default app;
