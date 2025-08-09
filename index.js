require('dotenv').config();
const express = require('express')
const cors = require('cors')
const app = express()
const jwt=require('jsonwebtoken')
const cookieParser=require('cookie-parser')
const port =process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


app.use(cors({
  origin:['http://localhost:5173','https://food-tracker-auth.web.app'],
  credentials:true
}));
app.use(express.json());
app.use(cookieParser())
const logger=(req,res,next)=>{
  console.log('inside the token midel ware')
  next()
}

const verifyToken=(req,res,next)=>{
  const token=req?.cookies?.token
  console.log({token})
  if(!token){
    return res.status(401).send({massage:'unauthorized Access'})
  }
  jwt.verify(token,process.env.JWT_ACCESS_SECRET,(err,decoded)=>{
    if(err){
      return res.status(401).send({massage:'unauthorized Access'})
    }
    req.decoded=decoded;
    next();
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ikrarq7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const foodsCollection = client.db("food_tracker").collection("foods");
    const reviewCollection = client.db("food_tracker").collection("review");
      //jwt api
      app.post('/jwt',async(req,res)=>{
        const userInfo=req.body;
        const token=jwt.sign(userInfo,process.env.JWT_ACCESS_SECRET,{
          expiresIn:'500000h'
        })
        res.cookie('token',token,{
          httpOnly:true,
          secure: process.env.NODE_ENV === "production" ? true: false,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        res.send({success:true})
      })
    //foods api
    app.get('/foods',verifyToken,logger,  async (req, res) => {
      const { searchParams, email } = req.query;
      const query = {};
    
      if (searchParams) {
        query.foodTitle = { $regex: searchParams, $options: 'i' };
      }
    
      if (email) {
        query.userEmail = email;
      }
    console.log('query',query);
      const result = await foodsCollection.find(query).toArray();
      res.send(result);
    });
    
    

   app.get('/foods/limit',verifyToken,logger, async (req, res) => {
  try {
    const currentDate = new Date();
    const result = await foodsCollection.find({
      expiryDate: { $gt: currentDate.toISOString() } 
    })
    .sort({ expiryDate: 1 }) 
    .limit(6)
    .toArray();
    
    res.send(result);
  } catch (error) {
    console.error('Error fetching limited foods:', error);
    res.status(500).send('Internal Server Error');
  }
});
// Add this route before the app.listen()
app.get('/foods/expired', async (req, res) => {
  try {
    const currentDate = new Date().toISOString();
    const result = await foodsCollection.find({
      expiryDate: { $lt: currentDate } // Finds foods where expiryDate is less than current date
    })
    .toArray();
    
    res.send(result);
  } catch (error) {
    console.error('Error fetching expired foods:', error);
    res.status(500).send('Internal Server Error');
  }
});
  app.get('/foods/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await foodsCollection.findOne(query);
      res.send(result);
    });
    app.post('/foods', async (req, res) => {
      const newFood = req.body;
      const result = await foodsCollection.insertOne(newFood);
      res.send(result);
    });
    
    //food delete api
    app.delete('/foods/:id',verifyToken,logger,async (req,res)=>{
      const id=req.params.id
      const query={_id:new ObjectId(id)}
      const result=await foodsCollection.deleteOne(query)
      res.send(result)
    })
    app.put('/foods/:id',verifyToken,logger, async (req, res) => {
      const id = req.params.id;
      const updatedFood = req.body;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: updatedFood,
      };
      const result = await foodsCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    });
    
    app.patch('/like/:foodId', async (req, res) => {
  const id = req.params.foodId;
  const email = req.body.userEmail;

  if (!email) {
    return res.status(400).send({ message: 'userEmail is required' });
  }

  const filter = { _id: new ObjectId(id) };
  const food = await foodsCollection.findOne(filter);

  if (!food) {
    return res.status(404).send({ message: 'Food not found' });
  }

  const alreadyLiked = food.likedBy?.includes(email);

  const updateDoc = alreadyLiked
    ? { $pull: { likedBy: email } }
    : { $addToSet: { likedBy: email } };

  await foodsCollection.updateOne(filter, updateDoc);

  res.send({
    message: alreadyLiked ? 'Dislike Successful' : 'Like Successful',
    liked: !alreadyLiked,
  });
});

    
//review api
    app.post('/review', verifyToken, async (req, res) => {
  try {
    const review = req.body;
    const userEmail = req.decoded.email; // Get email from verified token
    
    // Verify the user added the food item they're commenting on
    const foodItem = await foodsCollection.findOne({
      foodTitle: review.foodItem,
      userEmail: userEmail
    });
    
    if (!foodItem) {
      return res.status(403).send({ message: 'You can only add notes to items you added' });
    }
    
    // Add user email to the review for tracking
    review.userEmail = userEmail;
    review.postedDate = new Date().toISOString();
    
    const result = await reviewCollection.insertOne(review);
    res.send(result);
  } catch (error) {
    console.error('Error adding review:', error);
    res.status(500).send({ message: 'Internal server error' });
  }
});

    app.get('/review', async (req, res) => {
  const { foodItem } = req.query;
  const query = {};
  
  if (foodItem) {
    query.foodItem = foodItem;
  }
  
  const result = await reviewCollection.find(query).toArray();
  res.send(result);
});

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Server is running!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
