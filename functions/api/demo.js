const demoQuestions = [
  {type:"number",prompt:"24 × 13 = ?",answer:"312",options:[],hint:"Split 13 into 10 and 3.",explanation:"24 × 13 = (24 × 10) + (24 × 3) = 240 + 72 = 312.",topic:"Multiplication",practice_prompt:"24 × 14 = ?",practice_answer:"336"},
  {type:"multiple_choice",prompt:"Which fraction is equivalent to 1/2?",answer:"4/8",options:["2/3","3/8","4/8","5/12"],hint:"Multiply the numerator and denominator by the same number.",explanation:"1/2 × 4/4 = 4/8.",topic:"Fractions",practice_prompt:"Which fraction is equivalent to 1/3?",practice_answer:"2/6"},
  {type:"number",prompt:"A box holds 6 pencils. How many pencils are in 8 boxes?",answer:"48",options:[],hint:"Multiply the number in each box by the number of boxes.",explanation:"6 × 8 = 48 pencils.",topic:"Word problems",practice_prompt:"A bag holds 7 marbles. How many marbles are in 6 bags?",practice_answer:"42"},
  {type:"number",prompt:"What is 3/4 of 20?",answer:"15",options:[],hint:"First divide 20 by 4, then multiply by 3.",explanation:"20 ÷ 4 = 5, and 5 × 3 = 15.",topic:"Fractions",practice_prompt:"What is 2/5 of 30?",practice_answer:"12"},
  {type:"multiple_choice",prompt:"Which number is 100 more than 3,482?",answer:"3,582",options:["3,382","3,492","3,582","4,482"],hint:"Only the hundreds digit needs to increase by one.",explanation:"3,482 + 100 = 3,582.",topic:"Place value",practice_prompt:"What is 100 more than 5,614?",practice_answer:"5,714"}
];

export async function onRequestPost(context) {
  const id = crypto.randomUUID().slice(0,8).toUpperCase();
  const db = context.env.DB;
  if (!db) return Response.json({error:"D1 binding DB is missing."},{status:500});
  await db.prepare(`INSERT INTO homeworks (id,title,year_group,topic,questions_json,settings_json) VALUES (?,?,?,?,?,?)`)
    .bind(id,"Aaryan’s Year 4 Maths","Year 4","Mixed maths",JSON.stringify(demoQuestions),JSON.stringify({hints:true,mastery:true})).run();
  return Response.json({id});
}
