const hintSet=(h1,h2,h3,h4)=>[h1,h2,h3,h4];

// Demo question banks by age (UK primary). Each age shows FIVE questions chosen
// to (a) match the national curriculum for that year group and (b) showcase the
// range of answer types Verve supports: number, multiple_choice, drag, coins,
// sequence, fraction/shade, time, point, matching, etc.
// Age -> year group: 4 Reception, 5 Y1, 6 Y2, 7 Y3, 8 Y4, 9 Y5, 10 Y6, 11 Y7.
const questionBanks={
  // Reception (age 4): count to 10, recognise numbers/shapes, add within 5.
  4:[
    {type:"number",prompt:"How many apples? 🍎🍎🍎🍎",answer:"4",answer_unit:"apples",options:[],hints:hintSet("Touch each apple as you count.","Start at one.","Count: one, two, three, four.","There are 4 apples."),explanation:"There are 4 apples.",topic:"Counting",practice_prompt:"How many? 🍎🍎",practice_answer:"2"},
    {type:"drag",prompt:"Put 3 counters into the box.",answer:"3",drag_item_count:6,options:[],hints:hintSet("Move one counter at a time.","Count each one as you move it.","Stop when you reach three.","You need exactly 3 counters."),explanation:"Three counters belong in the box.",topic:"Counting",practice_prompt:"Show 2 counters.",practice_answer:"2"},
    {type:"multiple_choice",prompt:"Which shape is a circle?",answer:"○",options:["△","□","○"],hints:hintSet("A circle is perfectly round.","It has no corners.","Look for the round one.","○ is the circle."),explanation:"The round shape is a circle.",topic:"Shape",practice_prompt:"Which shape has three sides?",practice_answer:"△"},
    {type:"number",prompt:"2 add 1 more. How many altogether?",answer:"3",answer_unit:"",options:[],hints:hintSet("Hold up two fingers.","Now put up one more.","Count them all.","2 + 1 = 3."),explanation:"Two and one more make three.",topic:"Addition",practice_prompt:"1 add 1 more?",practice_answer:"2"},
    {type:"multiple_choice",prompt:"Which number is 5?",answer:"5",options:["2","5","8"],hints:hintSet("Five comes after four.","It is more than 2.","It is the middle finger count on one hand.","This is 5."),explanation:"That is the number 5.",topic:"Numbers",practice_prompt:"Which number is 3?",practice_answer:"3"}
  ],
  // Year 1 (age 5): numbers to 20, add/subtract within 10, halves, o'clock.
  5:[
    {type:"number",prompt:"What is 6 + 3?",answer:"9",answer_unit:"",options:[],hints:hintSet("Start at six and count on three.","Say seven, eight, nine.","Use your fingers if it helps.","6 + 3 = 9."),explanation:"6 + 3 = 9.",topic:"Addition",practice_prompt:"What is 5 + 2?",practice_answer:"7"},
    {type:"number",prompt:"There are 8 buns. 3 are eaten. How many are left?",answer:"5",answer_unit:"buns",options:[],hints:hintSet("This is a take-away.","Start at 8 and count back 3.","Count back: 7, 6, 5.","8 − 3 = 5."),explanation:"8 − 3 = 5 buns.",topic:"Subtraction",practice_prompt:"7 sweets, 2 eaten. How many left?",practice_answer:"5"},
    {type:"clock",prompt:"Make the clock show 3 o'clock.",answer:"3:00",clock_start:"12:00",options:[],hints:hintSet("At an o'clock time the long hand points to 12.","Move the short hour hand.","The hour hand should point to 3.","The clock shows 3:00."),explanation:"At 3 o'clock the short hand points to 3 and the long hand to 12.",topic:"Time",practice_prompt:"Show 6 o'clock.",practice_answer:"6:00"},
    {type:"fraction_visual",prompt:"Shade one half of the shape.",answer:"1/2",denominator:2,options:[],hints:hintSet("Half means one of two equal parts.","There are two equal parts.","Shade just one of them.","One of two parts is one half."),explanation:"One of two equal parts is one half.",topic:"Fractions",practice_prompt:"How many equal parts in a half?",practice_answer:"2"},
    {type:"number",prompt:"What number comes next? 2, 4, 6, 8, __",answer:"10",answer_unit:"",options:[],hints:hintSet("The numbers go up by the same amount.","Each is 2 more than the last.","Add 2 to 8.","8 + 2 = 10."),explanation:"Counting in twos, the next number is 10.",topic:"Counting in 2s",practice_prompt:"What comes next? 5, 10, 15, __",practice_answer:"20"}
  ],
  // Year 2 (age 6): numbers to 100, 2/5/10 times tables, coins, sequences.
  6:[
    {type:"number",prompt:"What is 7 + 5?",answer:"12",answer_unit:"",options:[],hints:hintSet("Make 10 first.","7 + 3 = 10, then add 2 more.","10 + 2 = 12.","7 + 5 = 12."),explanation:"7 + 5 = 12.",topic:"Addition",practice_prompt:"What is 6 + 5?",practice_answer:"11"},
    {type:"coins",prompt:"Which coins make 20p using exactly two coins?",answer:"10p, 10p",answer_unit:"",options:[],hints:hintSet("You need two coins that add to 20p.","Try two of the same coin.","10p and 10p make 20p.","Two 10p coins make 20p."),explanation:"10p + 10p = 20p.",topic:"Money",practice_prompt:"Two coins to make 10p?",practice_answer:"5p, 5p"},
    {type:"sequence",prompt:"Fill in the missing numbers: 5, 10, 15, __, __",answer:"20,25",options:[],hints:hintSet("This counts up in fives.","Add 5 each time.","15 + 5 = 20.","Then 20 + 5 = 25."),explanation:"Counting in fives: 20 then 25.",topic:"Counting in 5s",practice_prompt:"Continue: 2, 4, 6, __, __",practice_answer:"8,10"},
    {type:"number",prompt:"There are 5 bags with 2 apples in each. How many apples?",answer:"10",answer_unit:"apples",options:[],hints:hintSet("Add equal groups.","2 + 2 + 2 + 2 + 2.","That is five twos.","5 × 2 = 10."),explanation:"5 groups of 2 make 10.",topic:"Multiplication",practice_prompt:"3 bags with 2 sweets each?",practice_answer:"6"},
    {type:"multiple_choice",prompt:"Which number is greatest?",answer:"19",options:["9","14","19","16"],hints:hintSet("Compare the tens first.","Three numbers have 1 ten — compare their ones.","19 has 1 ten and 9 ones.","19 is the greatest."),explanation:"19 is greater than 16, 14 and 9.",topic:"Comparing numbers",practice_prompt:"Greatest: 8, 12 or 17?",practice_answer:"17"}
  ],
  // Year 3 (age 7): add/subtract to 3 digits, times tables, fractions, time.
  7:[
    {type:"number",prompt:"What is 36 + 27?",answer:"63",answer_unit:"",options:[],hints:hintSet("Add the tens, then the ones.","30 + 20 = 50; 6 + 7 = 13.","50 + 13 = 63.","36 + 27 = 63."),explanation:"36 + 27 = 63.",topic:"Addition",practice_prompt:"What is 45 + 18?",practice_answer:"63"},
    {type:"number",prompt:"What is 4 × 8?",answer:"32",answer_unit:"",options:[],hints:hintSet("Four groups of eight.","Double 8 to get 16.","Double 16 to get 32.","4 × 8 = 32."),explanation:"4 × 8 = 32.",topic:"Multiplication",practice_prompt:"What is 3 × 8?",practice_answer:"24"},
    {type:"coins",prompt:"Which three coins make 62p?",answer:"50p, 10p, 2p",answer_unit:"",options:[],hints:hintSet("Start with the biggest coin that fits.","50p leaves 12p.","10p leaves 2p.","50p + 10p + 2p = 62p."),explanation:"50p + 10p + 2p = 62p using three coins.",topic:"Money",practice_prompt:"Three coins to make 27p?",practice_answer:"20p, 5p, 2p"},
    {type:"number",prompt:"What is one quarter of 20?",answer:"5",answer_unit:"",options:[],hints:hintSet("Quarter means split into four equal parts.","Work out 20 ÷ 4.","4 × 5 = 20.","One quarter of 20 is 5."),explanation:"20 ÷ 4 = 5.",topic:"Fractions",practice_prompt:"One quarter of 16?",practice_answer:"4"},
    {type:"time",prompt:"School starts at half past eight. Enter the time.",answer:"8:30",answer_unit:"",options:[],hints:hintSet("Half past means 30 minutes after the hour.","The hour is eight.","Write 8, then 30.","Half past eight is 8:30."),explanation:"Half past eight is 8:30.",topic:"Time",practice_prompt:"Enter half past four.",practice_answer:"4:30"}
  ],
  // Year 4 (age 8): 4-digit numbers, ×/÷ facts to 12, fractions/decimals, time.
  8:[
    {type:"number",prompt:"What is 407 + 286?",answer:"693",answer_unit:"",options:[],hints:hintSet("Line up hundreds, tens and ones.","Add ones, then tens, then hundreds.","7 + 6 makes a regroup.","407 + 286 = 693."),explanation:"407 + 286 = 693.",topic:"Addition",practice_prompt:"What is 358 + 247?",practice_answer:"605"},
    {type:"number",prompt:"What is 8 × 7?",answer:"56",answer_unit:"",options:[],hints:hintSet("Use a fact you know.","8 × 5 = 40.","Add two more eights: 40 + 16.","8 × 7 = 56."),explanation:"8 × 7 = 56.",topic:"Multiplication",practice_prompt:"What is 6 × 8?",practice_answer:"48"},
    {type:"sequence",prompt:"Continue the pattern: 16, 12, 8, 4, __, __",answer:"0,-4",options:[],hints:hintSet("The numbers go down each time.","They go down by 4.","4 − 4 = 0.","Then 0 − 4 = −4."),explanation:"Subtracting 4 each time: 0 then −4.",topic:"Sequences",practice_prompt:"Continue: 20, 15, 10, __, __",practice_answer:"5,0"},
    {type:"shade",prompt:"Shade 3/4 of the grid.",answer:"3/4",shade_fraction:"3/4",shade_rows:1,shade_cols:4,options:[],hints:hintSet("The grid has 4 equal parts.","Three quarters means three of the four.","Shade three squares.","3 of 4 squares is 3/4."),explanation:"Shading 3 of 4 equal parts shows 3/4.",topic:"Fractions",practice_prompt:"How many quarters make a whole?",practice_answer:"4"},
    {type:"time",prompt:"A film starts at 14:20 and lasts 50 minutes. What time does it finish?",answer:"15:10",answer_unit:"",options:[],hints:hintSet("First reach the next hour.","14:20 to 15:00 is 40 minutes.","10 minutes are left after 15:00.","The finish time is 15:10."),explanation:"40 minutes reaches 15:00, then 10 more gives 15:10.",topic:"Time",practice_prompt:"Starts 10:35, lasts 40 min. Ends?",practice_answer:"11:15"}
  ],
  // Year 5 (age 9): numbers to 1,000,000, multi-digit ×, fractions of amounts,
  // perimeter, coordinates.
  9:[
    {type:"number",prompt:"What is 3406 + 2785?",answer:"6191",answer_unit:"",options:[],hints:hintSet("Line up the place values.","Add ones, tens, hundreds, thousands.","Regroup where a column reaches 10.","3406 + 2785 = 6191."),explanation:"3406 + 2785 = 6191.",topic:"Addition",practice_prompt:"What is 4217 + 3684?",practice_answer:"7901"},
    {type:"number",prompt:"What is 7 × 46?",answer:"322",answer_unit:"",options:[],hints:hintSet("Split 46 into 40 and 6.","7 × 40 = 280.","7 × 6 = 42.","280 + 42 = 322."),explanation:"7 × 40 = 280 and 7 × 6 = 42; total 322.",topic:"Multiplication",practice_prompt:"What is 6 × 38?",practice_answer:"228"},
    {type:"number",prompt:"What is 3/5 of 45?",answer:"27",answer_unit:"",options:[],hints:hintSet("Find one fifth first.","45 ÷ 5 = 9.","One fifth is 9; take three of them.","3 × 9 = 27."),explanation:"45 ÷ 5 = 9 and 9 × 3 = 27.",topic:"Fractions",practice_prompt:"What is 2/3 of 36?",practice_answer:"24"},
    {type:"number",prompt:"A rectangle is 9 cm long and 4 cm wide. What is its perimeter?",answer:"26",answer_unit:"cm",options:[],hints:hintSet("Perimeter is the distance all the way round.","Add both lengths and both widths.","9 + 4 + 9 + 4.","The perimeter is 26 cm."),explanation:"9 + 4 + 9 + 4 = 26 cm.",topic:"Measurement",practice_prompt:"Perimeter of a 7 cm by 3 cm rectangle?",practice_answer:"20"},
    {type:"point",prompt:"Select the point (3, 2) on the grid.",answer:"[3,2]",point_answer:[3,2],grid_bounds:[0,6,0,6],grid_step:1,options:[],hints:hintSet("Start at the origin (0,0).","Move 3 to the right along the x-axis.","Then move 2 up.","The point is where x = 3 and y = 2."),explanation:"(3, 2) is 3 right and 2 up.",topic:"Coordinates",practice_prompt:"Which coordinate is 1 right and 4 up?",practice_answer:"(1,4)"}
  ],
  // Year 6 (age 10): 4-digit ×/÷, decimals, fractions to decimals, timetables,
  // matching.
  10:[
    {type:"number",prompt:"What is 4832 − 2967?",answer:"1865",answer_unit:"",options:[],hints:hintSet("Subtract by place value.","Exchange across columns where needed.","Start with the ones column.","4832 − 2967 = 1865."),explanation:"The difference is 1865.",topic:"Subtraction",practice_prompt:"What is 6104 − 3758?",practice_answer:"2346"},
    {type:"number",prompt:"What is 34 × 27?",answer:"918",answer_unit:"",options:[],hints:hintSet("Split 27 into 20 and 7.","34 × 20 = 680.","34 × 7 = 238.","680 + 238 = 918."),explanation:"34 × 20 = 680 and 34 × 7 = 238; total 918.",topic:"Multiplication",practice_prompt:"What is 26 × 32?",practice_answer:"832"},
    {type:"fraction",prompt:"Write 0.75 as a fraction in its simplest form.",answer:"3/4",answer_unit:"",options:[],hints:hintSet("0.75 means 75 hundredths.","That is 75/100.","Divide top and bottom by 25.","0.75 = 3/4."),explanation:"75/100 simplifies to 3/4.",topic:"Fractions and decimals",practice_prompt:"Write 0.6 as a fraction in simplest form.",practice_answer:"3/5"},
    {type:"number",prompt:"A train leaves at 09:47 and arrives at 11:18. How many minutes is the journey?",answer:"91",answer_unit:"minutes",options:[],hints:hintSet("Break the journey at whole hours.","09:47 to 10:00 is 13 minutes.","10:00 to 11:00 is 60 minutes, then 18 more.","13 + 60 + 18 = 91 minutes."),explanation:"The journey lasts 91 minutes.",topic:"Time",practice_prompt:"Minutes from 13:38 to 15:05?",practice_answer:"87"},
    {type:"matching",prompt:"Connect each fraction to its equivalent decimal.",answer:"interactive",options:[],matching_left:["1/2","1/4","3/4"],matching_right:["0.25","0.5","0.75"],matching_pairs:["1/2->0.5","1/4->0.25","3/4->0.75"],hints:hintSet("Start with a fraction you know.","One half is 0.5.","One quarter is 0.25.","Three quarters is 0.75."),explanation:"1/2 = 0.5, 1/4 = 0.25 and 3/4 = 0.75.",topic:"Fractions and decimals",practice_prompt:"Write 2/5 as a decimal.",practice_answer:"0.4"}
  ],
  // Year 7 (age 11): decimals ×, simple algebra, percentages, mean, comparing
  // fractions.
  11:[
    {type:"number",prompt:"What is 3.6 × 25?",answer:"90",answer_unit:"",options:[],hints:hintSet("×25 is the same as ×100 then ÷4.","3.6 × 100 = 360.","360 ÷ 4 = 90.","3.6 × 25 = 90."),explanation:"3.6 × 25 = 90.",topic:"Decimals",practice_prompt:"What is 4.8 × 25?",practice_answer:"120"},
    {type:"number",prompt:"Solve: 4x + 7 = 31. What is x?",answer:"6",answer_unit:"",options:[],hints:hintSet("Undo the operations in reverse.","Subtract 7 from both sides: 4x = 24.","Divide both sides by 4.","x = 6."),explanation:"31 − 7 = 24 and 24 ÷ 4 = 6.",topic:"Algebra",practice_prompt:"Solve: 5x + 3 = 38.",practice_answer:"7"},
    {type:"number",prompt:"A jacket costs 60 pounds and is reduced by 15%. What is the sale price in pounds?",answer:"51",answer_unit:"£",options:[],hints:hintSet("Find 10% and 5% first.","10% of 60 is 6; 5% is 3.","15% is 9.","60 − 9 = 51."),explanation:"The discount is £9, so the sale price is £51.",topic:"Percentages",practice_prompt:"An 80 pound item reduced by 20%. Sale price?",practice_answer:"64"},
    {type:"number",prompt:"The mean of 8, 11, 13 and x is 12. What is x?",answer:"16",answer_unit:"",options:[],hints:hintSet("Four numbers with mean 12 total 48.","Add the known three: 8 + 11 + 13 = 32.","48 − 32 = 16.","x = 16."),explanation:"The total must be 48; 48 − 32 = 16.",topic:"Statistics",practice_prompt:"Mean of 5, 9 and x is 8. Find x.",practice_answer:"10"},
    {type:"multiple_choice",prompt:"Which fraction is largest?",answer:"5/6",options:["3/4","4/5","5/6","7/10"],hints:hintSet("Compare using decimals.","3/4 = 0.75; 4/5 = 0.8.","5/6 ≈ 0.833.","5/6 is the largest."),explanation:"5/6 is greater than the other options.",topic:"Fractions",practice_prompt:"Which is larger: 7/8 or 5/6?",practice_answer:"7/8"}
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
