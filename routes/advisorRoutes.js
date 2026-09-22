const express=require('express');
const {rateLimit}=require('express-rate-limit');
const {requireRole}=require('../middlewares/authMiddleware');
const {getSalesCalendar}=require('../services/salesCalendar');
const {answerWithAI}=require('../services/aiAdvisor');
function createAdvisorRoutes(prisma,requireAuth,config) {
 const router=express.Router();
 router.use(requireAuth,requireRole('STORE_OWNER'));
 router.use(rateLimit({windowMs:60000,limit:15,keyGenerator:req=>String(req.auth.user.id),standardHeaders:'draft-7',legacyHeaders:false,message:{message:'Bạn hỏi hơi nhanh. Vui lòng chờ một phút rồi thử lại.'}}));
 router.get('/status',(req,res)=>res.json({configured:Boolean(config.aiApiKey && config.aiModel)}));
 router.get('/calendar',async(req,res,next)=>{
  const leadDays=Number(req.query.leadDays??2);
  if(!Number.isInteger(leadDays)||leadDays<0||leadDays>14) return res.status(400).json({message:'Thời gian giao hàng từ 0 đến 14 ngày.'});
  try { res.json(await getSalesCalendar(prisma,req.auth.user.id,leadDays)); }catch(e){next(e);}
 });
 router.post('/chat',async(req,res,next)=>{
  const {message,history=[],leadDays=2}=req.body||{};
  if(typeof message!=='string'||!message.trim()||message.length>1000||!Number.isInteger(leadDays)||leadDays<0||leadDays>14||!Array.isArray(history)||history.length>6||history.some(h=>!h||!['user','assistant'].includes(h.role)||typeof h.content!=='string'||h.content.length>1500)) return res.status(400).json({message:'Câu hỏi tối đa 1.000 ký tự; lịch sử tối đa 6 tin nhắn.'});
  try {
   const calendar=await getSalesCalendar(prisma,req.auth.user.id,leadDays);
   const answer=await answerWithAI({message:message.trim(),history,calendar,apiKey:config.aiApiKey,model:config.aiModel});
   res.json({...answer,checkedAt:calendar.generatedAt});
  }catch(e){next(e);}
 });
 return router;
}
module.exports={createAdvisorRoutes};
