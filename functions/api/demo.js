const hintSet=(h1,h2,h3,h4)=>[h1,h2,h3,h4];

const questionBanks={
  6:[
    {type:"number",prompt:"What is 7 + 5?",answer:"12",answer_unit:"",options:[],hint:"Start at 7 and count on.",hints:hintSet("Start at 7 and count on.","Count on five steps from 7.","Say 8, 9, 10, 11, then one more.","7 + 5 can be split into 7 + 3 + 2. Reach 10 first, then add 2."),explanation:"7 + 5 = 12.",topic:"Addition",practice_prompt:"What is 6 + 5?",practice_answer:"11"},
    {type:"multiple_choice",prompt:"Which number is greatest?",answer:"19",options:["9","14","19","16"],hint:"Look for the number with the most tens and ones.",hints:hintSet("Look for the number with the most tens and ones.","Compare the tens first.","Three numbers have 1 ten. Compare their ones.","19 has 1 ten and 9 ones, so it is the greatest."),explanation:"19 is greater than 16, 14 and 9.",topic:"Comparing numbers",practice_prompt:"Which is greatest: 8, 12 or 17?",practice_answer:"17"},
    {type:"number",prompt:"There are 10 birds. 3 fly away. How many remain?",answer:"7",answer_unit:"birds",options:[],hint:"This is a taking-away question.",hints:hintSet("This is a taking-away question.","Start with 10 and count back 3.","Count back 9, 8, 7.","10 − 3 = 7."),explanation:"10 − 3 = 7 birds.",topic:"Subtraction",practice_prompt:"There are 9 frogs. 2 hop away. How many remain?",practice_answer:"7"},
    {type:"multiple_choice",prompt:"Which shape has three sides?",answer:"Triangle",options:["Square","Triangle","Circle","Rectangle"],hint:"Count the straight sides.",hints:hintSet("Count the straight sides.","You need a shape with exactly three straight edges.","A square and rectangle have four sides; a circle has none.","A triangle has three sides."),explanation:"A triangle has three sides.",topic:"Shape",practice_prompt:"Which shape has four equal sides?",practice_answer:"Square"},
    {type:"number",prompt:"What number comes next: 2, 4, 6, 8, __?",answer:"10",answer_unit:"",options:[],hint:"The numbers increase by the same amount.",hints:hintSet("The numbers increase by the same amount.","Each number is 2 more than the last.","Add 2 to 8.","8 + 2 = 10."),explanation:"The pattern counts in twos, so the next number is 10.",topic:"Patterns",practice_prompt:"What comes next: 5, 10, 15, __?",practice_answer:"20"}
  ],
  7:[
    {type:"number",prompt:"What is 36 + 27?",answer:"63",answer_unit:"",options:[],hint:"Add tens and ones.",hints:hintSet("Add tens and ones.","Add 30 + 20, then 6 + 7.","50 + 13 can be regrouped.","36 + 27 = 63."),explanation:"36 + 27 = 63.",topic:"Addition",practice_prompt:"What is 45 + 18?",practice_answer:"63"},
    {type:"number",prompt:"What is 52 − 19?",answer:"33",answer_unit:"",options:[],hint:"Subtract 20, then add 1 back.",hints:hintSet("Think of 19 as nearly 20.","Subtract 20 first.","52 − 20 = 32; adjust because you subtracted one too many.","52 − 19 = 33."),explanation:"52 − 20 = 32, then add 1 = 33.",topic:"Subtraction",practice_prompt:"What is 61 − 29?",practice_answer:"32"},
    {type:"number",prompt:"There are 5 bags with 4 apples in each. How many apples?",answer:"20",answer_unit:"apples",options:[],hint:"Use equal groups.",hints:hintSet("Use equal groups.","Add five groups of 4.","4 + 4 + 4 + 4 + 4.","5 × 4 = 20."),explanation:"5 groups of 4 make 20 apples.",topic:"Multiplication",practice_prompt:"There are 3 bags with 6 apples in each. How many apples?",practice_answer:"18"},
    {type:"multiple_choice",prompt:"Which fraction shows one half?",answer:"3/6",options:["1/3","2/5","3/6","4/5"],hint:"The numerator should be half the denominator.",hints:hintSet("The numerator should be half the denominator.","Ask which denominator can be split into two equal groups.","Half of 6 is 3.","3/6 is equal to one half."),explanation:"3 is half of 6, so 3/6 = 1/2.",topic:"Fractions",practice_prompt:"Which is one half: 2/4 or 3/4?",practice_answer:"2/4"},
    {type:"time",prompt:"School starts at half past eight. Enter the time.",answer:"8:30",answer_unit:"",options:[],hint:"Half past means 30 minutes after the hour.",hints:hintSet("Half past means 30 minutes after the hour.","The hour is eight.","Write 8 in the hour box and 30 in minutes.","Half past eight is 8:30."),explanation:"Half past eight is 8:30.",topic:"Time",practice_prompt:"Enter half past four.",practice_answer:"4:30"}
  ],
  8:[
    {type:"number",prompt:"What is 407 + 286?",answer:"693",answer_unit:"",options:[],hint:"Line up hundreds, tens and ones.",hints:hintSet("Line up hundreds, tens and ones.","Add the ones, then tens, then hundreds.","7 + 6 creates a regroup.","407 + 286 = 693."),explanation:"407 + 286 = 693.",topic:"Addition",practice_prompt:"What is 358 + 247?",practice_answer:"605"},
    {type:"number",prompt:"What is 8 × 7?",answer:"56",answer_unit:"",options:[],hint:"Use a known multiplication fact.",hints:hintSet("Use a known multiplication fact.","Think of 7 groups of 8.","Use 8 × 5 and add two more groups of 8.","40 + 16 = 56."),explanation:"8 × 7 = 56.",topic:"Multiplication",practice_prompt:"What is 6 × 8?",practice_answer:"48"},
    {type:"number",prompt:"What is one quarter of 28?",answer:"7",answer_unit:"",options:[],hint:"Divide into four equal groups.",hints:hintSet("Divide into four equal groups.","Calculate 28 ÷ 4.","Use the fact 4 × 7 = 28.","One quarter of 28 is 7."),explanation:"28 ÷ 4 = 7.",topic:"Fractions",practice_prompt:"What is one quarter of 36?",practice_answer:"9"},
    {type:"time",prompt:"A film starts at 14:20 and lasts 50 minutes. What time does it finish?",answer:"15:10",answer_unit:"",options:[],hint:"First reach the next hour.",hints:hintSet("First reach the next hour.","From 14:20 to 15:00 is 40 minutes.","There are 10 minutes left after reaching 15:00.","The finish time is 15:10."),explanation:"40 minutes reaches 15:00, then 10 more gives 15:10.",topic:"Time",practice_prompt:"A lesson starts at 10:35 and lasts 40 minutes. When does it end?",practice_answer:"11:15"},
    {type:"multiple_choice",prompt:"Which number is closest to 500?",answer:"492",options:["451","492","527","563"],hint:"Compare each number’s distance from 500.",hints:hintSet("Compare each number’s distance from 500.","Find how far below or above 500 each is.","492 is 8 away; 527 is 27 away.","492 is closest to 500."),explanation:"492 is only 8 away from 500.",topic:"Estimation",practice_prompt:"Which is closer to 100: 93 or 112?",practice_answer:"93"}
  ],
  9:[
    {type:"number",prompt:"What is 3,406 + 2,785?",answer:"6191",answer_unit:"",options:[],hint:"Align place values carefully.",hints:hintSet("Align place values carefully.","Add ones, tens, hundreds and thousands.","Regroup where a column totals 10 or more.","3,406 + 2,785 = 6,191."),explanation:"3,406 + 2,785 = 6,191.",topic:"Addition",practice_prompt:"What is 4,217 + 3,684?",practice_answer:"7901"},
    {type:"number",prompt:"What is 7 × 46?",answer:"322",answer_unit:"",options:[],hint:"Partition 46.",hints:hintSet("Partition 46.","Multiply 7 by 40 and by 6.","280 + 42 remains to combine.","7 × 46 = 322."),explanation:"7 × 40 = 280 and 7 × 6 = 42; total 322.",topic:"Multiplication",practice_prompt:"What is 6 × 38?",practice_answer:"228"},
    {type:"number",prompt:"What is 3/5 of 45?",answer:"27",answer_unit:"",options:[],hint:"Find one fifth first.",hints:hintSet("Find one fifth first.","Calculate 45 ÷ 5.","One fifth is 9; take three groups.","3 × 9 = 27."),explanation:"45 ÷ 5 = 9 and 9 × 3 = 27.",topic:"Fractions",practice_prompt:"What is 2/3 of 36?",practice_answer:"24"},
    {type:"number",prompt:"A rectangle is 9 cm long and 4 cm wide. What is its perimeter?",answer:"26",answer_unit:"cm",options:[],hint:"Perimeter is the distance around the edge.",hints:hintSet("Perimeter is the distance around the edge.","Add both lengths and both widths.","Calculate 9 + 4 + 9 + 4.","The perimeter is 26 cm."),explanation:"9 + 4 + 9 + 4 = 26 cm.",topic:"Measurement",practice_prompt:"Find the perimeter of a 7 cm by 3 cm rectangle.",practice_answer:"20"},
    {type:"point",prompt:"Select the point (3, 2) on the coordinate grid.",answer:"[3,2]",point_answer:[3,2],grid_bounds:[-5,5,-5,5],grid_step:1,options:[],hint:"Start at the origin and move along the x-axis first.",hints:hintSet("Start at the origin and move along the x-axis first.","Move 3 units to the right.","Then move 2 units upwards.","The point is where x = 3 and y = 2."),explanation:"The coordinate (3, 2) is 3 units right and 2 units up.",topic:"Coordinates",practice_prompt:"Which coordinate is 2 left and 4 up from the origin?",practice_answer:"(-2,4)"}
  ],
  10:[
    {type:"number",prompt:"What is 4,832 − 2,967?",answer:"1865",answer_unit:"",options:[],hint:"Subtract by place value and exchange where needed.",hints:hintSet("Subtract by place value and exchange where needed.","Start with the ones column.","Exchange across columns carefully.","4,832 − 2,967 = 1,865."),explanation:"The difference is 1,865.",topic:"Subtraction",practice_prompt:"What is 6,104 − 3,758?",practice_answer:"2346"},
    {type:"number",prompt:"What is 34 × 27?",answer:"918",answer_unit:"",options:[],hint:"Partition 27 into 20 and 7.",hints:hintSet("Partition 27 into 20 and 7.","Calculate 34 × 20 and 34 × 7.","680 + 238 remains to combine.","34 × 27 = 918."),explanation:"34 × 20 = 680 and 34 × 7 = 238; total 918.",topic:"Multiplication",practice_prompt:"What is 26 × 32?",practice_answer:"832"},
    {type:"number",prompt:"Write 0.75 as a fraction in its simplest form.",answer:"3/4",answer_unit:"",options:[],hint:"Think of 0.75 as hundredths.",hints:hintSet("Think of 0.75 as hundredths.","0.75 means 75/100.","Simplify 75/100 by dividing both numbers by 25.","0.75 = 3/4."),explanation:"75/100 simplifies to 3/4.",topic:"Fractions and decimals",practice_prompt:"Write 0.6 as a fraction in simplest form.",practice_answer:"3/5"},
    {type:"number",prompt:"A train leaves at 09:47 and arrives at 11:18. How long is the journey?",answer:"91",answer_unit:"minutes",options:[],hint:"Break the journey at whole hours.",hints:hintSet("Break the journey at whole hours.","09:47 to 10:00 is 13 minutes.","10:00 to 11:00 is 60 minutes, then 18 more.","13 + 60 + 18 = 91 minutes."),explanation:"The journey lasts 91 minutes.",topic:"Time",practice_prompt:"How many minutes from 13:38 to 15:05?",practice_answer:"87"},
    {type:"matching",prompt:"Connect each fraction to its equivalent decimal.",answer:"interactive",options:[],matching_left:["1/2","1/4","3/4"],matching_right:["0.25","0.5","0.75"],matching_pairs:["1/2->0.5","1/4->0.25","3/4->0.75"],hint:"Start with a fraction you know well.",hints:hintSet("Start with a fraction you know well.","One half is 0.5.","One quarter is 0.25.","Three quarters is 0.75."),explanation:"1/2 = 0.5, 1/4 = 0.25 and 3/4 = 0.75.",topic:"Fractions and decimals",practice_prompt:"Write 2/5 as a decimal.",practice_answer:"0.4"}
  ],
  11:[
    {type:"number",prompt:"What is 3.6 × 25?",answer:"90",answer_unit:"",options:[],hint:"Use the relationship between 25 and 100.",hints:hintSet("Use the relationship between 25 and 100.","Multiplying by 25 is the same as multiplying by 100 then dividing by 4.","3.6 × 100 = 360.","360 ÷ 4 = 90."),explanation:"3.6 × 25 = 90.",topic:"Decimals",practice_prompt:"What is 4.8 × 25?",practice_answer:"120"},
    {type:"number",prompt:"Solve: 4x + 7 = 31",answer:"6",answer_unit:"",options:[],hint:"Undo the operations in reverse order.",hints:hintSet("Undo the operations in reverse order.","Subtract 7 from both sides.","4x = 24 remains.","Divide both sides by 4, so x = 6."),explanation:"31 − 7 = 24 and 24 ÷ 4 = 6.",topic:"Algebra",practice_prompt:"Solve: 5x + 3 = 38",practice_answer:"7"},
    {type:"number",prompt:"A £60 jacket is reduced by 15%. What is the sale price?",answer:"51",answer_unit:"£",options:[],hint:"Find 10% and 5% first.",hints:hintSet("Find 10% and 5% first.","10% of £60 is £6; 5% is half of that.","15% is £9.","£60 − £9 = £51."),explanation:"The discount is £9, so the sale price is £51.",topic:"Percentages",practice_prompt:"A £80 item is reduced by 20%. What is the sale price?",practice_answer:"64"},
    {type:"number",prompt:"The mean of 8, 11, 13 and x is 12. What is x?",answer:"16",answer_unit:"",options:[],hint:"Use the total needed for a mean of 12.",hints:hintSet("Use the total needed for a mean of 12.","Four numbers with mean 12 have total 48.","The known numbers total 32.","48 − 32 = 16."),explanation:"The total must be 48; 48 − 32 = 16.",topic:"Statistics",practice_prompt:"The mean of 5, 9 and x is 8. Find x.",practice_answer:"10"},
    {type:"multiple_choice",prompt:"Which fraction is largest?",answer:"5/6",options:["3/4","4/5","5/6","7/10"],hint:"Compare using common denominators or decimals.",hints:hintSet("Compare using common denominators or decimals.","Estimate each fraction’s distance from 1.","5/6 is about 0.833; 4/5 is 0.8.","5/6 is the largest."),explanation:"5/6 is greater than the other options.",topic:"Fractions",practice_prompt:"Which is larger: 7/8 or 5/6?",practice_answer:"7/8"}
  ]
};

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const age=Math.max(6,Math.min(11,Number(body.age)||8));
    const questions=questionBanks[age]||questionBanks[8];
    const id=crypto.randomUUID().slice(0,8).toUpperCase();
    const db=context.env.DB;
    if(!db) return Response.json({error:"D1 binding DB is missing."},{status:500});

    await db.prepare(`INSERT INTO homeworks
      (id,title,year_group,topic,questions_json,settings_json)
      VALUES (?,?,?,?,?,?)`)
      .bind(
        id,
        `Maths demo for age ${age}`,
        `Age ${age}`,
        "Age-appropriate mixed maths",
        JSON.stringify(questions),
        JSON.stringify({hints:true,mastery:true,demo:true,age})
      ).run();

    return Response.json({id,age});
  }catch(error){
    return Response.json({error:error.message||"The demo could not be created."},{status:500});
  }
}
