const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
require("dotenv").config();

const port = process.env.PORT || 5000;
const OpenAI = require("openai").default;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000", "https://food-tracker-auth.web.app"],
    credentials: true,
  })
);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ikrarq7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Helper function to create notifications
async function createNotification(notificationData) {
  try {
    const notification = {
      userEmail: notificationData.userEmail,
      type: notificationData.type,
      message: notificationData.message,
      foodId: notificationData.foodId || null,
      foodTitle: notificationData.foodTitle || null,
      relatedUser: notificationData.relatedUser || null,
      read: false,
      createdAt: new Date().toISOString(),
    };

    const result = await notificationsCollection.insertOne(notification);
    console.log(`📢 Notification created: ${notification.message}`);
    return result;
  } catch (error) {
    console.error("Error creating notification:", error);
  }
}

// Function to create notifications for expiring foods
async function createExpiryNotifications() {
  try {
    const now = new Date();
    const threeDaysLater = new Date();
    threeDaysLater.setDate(now.getDate() + 3);

    // Find foods expiring in next 3 days that haven't had notifications sent
    const expiringFoods = await foodsCollection
      .find({
        expiryDate: {
          $gte: now.toISOString(),
          $lte: threeDaysLater.toISOString(),
        },
        expiryNotificationSent: { $ne: true },
      })
      .toArray();

    for (const food of expiringFoods) {
      // Calculate days until expiry
      const expiryDate = new Date(food.expiryDate);
      const daysUntilExpiry = Math.ceil(
        (expiryDate - now) / (1000 * 60 * 60 * 24)
      );

      let message = "";
      let type = "expiry_soon";

      if (daysUntilExpiry === 0) {
        message = `🚨 "${food.foodTitle}" expires today! Use it soon.`;
        type = "expiry_today";
      } else if (daysUntilExpiry === 1) {
        message = `⚠️ "${food.foodTitle}" expires tomorrow!`;
      } else {
        message = `📅 "${food.foodTitle}" expires in ${daysUntilExpiry} days.`;
      }

      // Create expiry notification
      await createNotification({
        userEmail: food.userEmail,
        type: type,
        message: message,
        foodId: food._id.toString(),
        foodTitle: food.foodTitle,
        relatedUser: food.userEmail,
      });

      // Mark food as having expiry notification sent
      await foodsCollection.updateOne(
        { _id: food._id },
        { $set: { expiryNotificationSent: true } }
      );
    }

    // Check for expired foods
    const expiredFoods = await foodsCollection
      .find({
        expiryDate: { $lt: now.toISOString() },
        expiredNotificationSent: { $ne: true },
      })
      .toArray();

    for (const food of expiredFoods) {
      const message = `❌ "${food.foodTitle}" has expired! Consider discarding it.`;

      // Create expired food notification
      await createNotification({
        userEmail: food.userEmail,
        type: "expired",
        message: message,
        foodId: food._id.toString(),
        foodTitle: food.foodTitle,
        relatedUser: food.userEmail,
      });

      // Mark food as having expired notification sent
      await foodsCollection.updateOne(
        { _id: food._id },
        { $set: { expiredNotificationSent: true } }
      );
    }

    console.log(
      `📢 Created notifications for ${expiringFoods.length} expiring foods and ${expiredFoods.length} expired foods`
    );
  } catch (error) {
    console.error("Error creating expiry notifications:", error);
  }
}

let foodsCollection, reviewCollection, notificationsCollection, usersCollection;

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    
    foodsCollection = client.db("food_tracker").collection("foods");
    reviewCollection = client.db("food_tracker").collection("review");
    notificationsCollection = client.db("food_tracker").collection("notifications");
    usersCollection = client.db("food_tracker").collection("users");

    // JWT Token API (optional - if you still want it for other purposes)
    app.post("/jwt", async (req, res) => {
      const userInfo = req.body;
      const token = jwt.sign(userInfo, process.env.JWT_ACCESS_SECRET, {
        expiresIn: "500000h",
      });
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" ? true : false,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });
      res.send({ success: true });
    });

    // Logout API
    app.post("/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" ? true : false,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });
      res.send({ success: true, message: "Logged out successfully" });
    });

    // Node mailer setup
    const emailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    app.get("/send-login-email", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).send("Email is required");

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Login Notification - Food Tracker",
        html: `<p>Welcome! You logged in successfully.</p>`,
      };

      try {
        await emailTransporter.sendMail(mailOptions);
        console.log("Email sent to", email);
        res.send("Email sent successfully");
      } catch (err) {
        console.error("Error sending email", err);
        res.status(500).send("Failed to send email");
      }
    });

    // AI Chat API
    app.post("/ai-chat", async (req, res) => {
      try {
        const { message } = req.body;
        if (!message)
          return res
            .status(400)
            .send({ success: false, error: "Message is required" });

        const systemPrompt = `
          You are a helpful AI assistant for a Food Tracker application.
          Website features:
          - Users can track food items with expiry dates
          - Add reviews/notes for food items
          - Like food items
          - Get notifications for expiring foods
          - Manage food inventory
          - Food safety and storage guidance
          
          Always answer questions about:
          - Food tracking and expiry management
          - Food storage best practices
          - Reducing food waste
          - Nutrition information
          - Recipe suggestions based on available ingredients
          - Food safety guidelines
          
          Be polite, helpful, and provide practical advice. If users ask about non-food topics, gently steer them back to food-related questions.
        `;

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          temperature: 0.7,
          max_tokens: 500,
        });

        const reply = response.choices[0].message.content;
        res.send({ success: true, reply });
      } catch (err) {
        console.error("AI Chat Error:", err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    // Foods API
    app.get("/foods", async (req, res) => {
      try {
        const { searchParams, email } = req.query;
        const query = {};

        if (searchParams) {
          query.foodTitle = { $regex: searchParams, $options: "i" };
        }

        if (email) {
          query.userEmail = email;
        }

        console.log("query", query);
        const result = await foodsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching foods:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/foods/limit", async (req, res) => {
      try {
        const currentDate = new Date();
        const result = await foodsCollection
          .find({
            expiryDate: { $gt: currentDate.toISOString() },
          })
          .sort({ expiryDate: 1 })
          .limit(6)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching limited foods:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/foods/expired", async (req, res) => {
      try {
        const currentDate = new Date().toISOString();
        const result = await foodsCollection
          .find({
            expiryDate: { $lt: currentDate },
          })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching expired foods:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/foods/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid food ID" });
        }

        const query = { _id: new ObjectId(id) };
        const result = await foodsCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Food not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error fetching food:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Create food
    app.post("/foods", async (req, res) => {
      try {
        const newFood = req.body;

        console.log("📥 Received food data:", newFood);

        // Validate required fields
        if (!newFood.foodTitle || !newFood.expiryDate || !newFood.userEmail) {
          return res.status(400).send({
            success: false,
            message:
              "Missing required fields: foodTitle, expiryDate, userEmail",
          });
        }

        const foodData = {
          foodImage: newFood.foodImage || "",
          foodTitle: newFood.foodTitle,
          category: newFood.foodCategory || newFood.category || "Other",
          quantity: newFood.quantity || 1,
          expiryDate: newFood.expiryDate,
          description: newFood.description || "",
          userEmail: newFood.userEmail,
          addedDate: new Date().toISOString(),
          likedBy: [],
          expiryNotificationSent: false,
          expiredNotificationSent: false,
        };

        const result = await foodsCollection.insertOne(foodData);

        // Create notification for food addition
        await createNotification({
          userEmail: newFood.userEmail,
          type: "food_added",
          message: `📦 You added "${newFood.foodTitle}" to your fridge`,
          foodId: result.insertedId.toString(),
          foodTitle: newFood.foodTitle,
          relatedUser: newFood.userEmail,
        });

        res.send({
          success: true,
          insertedId: result.insertedId,
          message: "Food added successfully",
        });
      } catch (error) {
        console.error("❌ Error adding food:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error",
          error: error.message,
        });
      }
    });

    // Food delete API
    app.delete("/foods/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid food ID" });
        }

        const query = { _id: new ObjectId(id) };
        const food = await foodsCollection.findOne(query);

        if (!food) {
          return res.status(404).send({ message: "Food not found" });
        }

        const result = await foodsCollection.deleteOne(query);

        // Create notification for food deletion
        await createNotification({
          userEmail: food.userEmail,
          type: "food_removed",
          message: `🗑️ You removed "${food.foodTitle}" from your fridge`,
          foodTitle: food.foodTitle,
          relatedUser: food.userEmail,
        });

        res.send({
          success: true,
          message: "Food deleted successfully",
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error("Error deleting food:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.put("/foods/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedFood = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid food ID" });
        }

        const filter = { _id: new ObjectId(id) };
        const existingFood = await foodsCollection.findOne(filter);

        if (!existingFood) {
          return res.status(404).send({ message: "Food not found" });
        }

        const options = { upsert: false };
        const updateDoc = {
          $set: updatedFood,
        };

        const result = await foodsCollection.updateOne(
          filter,
          updateDoc,
          options
        );

        res.send({
          success: true,
          message: "Food updated successfully",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error updating food:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Get foods that are expiring soon (within next 5 days)
    app.get("/foods/expiring-soon", async (req, res) => {
      try {
        const now = new Date();
        const fiveDaysLater = new Date();
        fiveDaysLater.setDate(now.getDate() + 5);

        const result = await foodsCollection
          .find({
            expiryDate: {
              $gte: now.toISOString(),
              $lte: fiveDaysLater.toISOString(),
            },
          })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching expiring soon foods:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Like/Unlike food with notification
    app.patch("/like/:foodId", async (req, res) => {
      try {
        const foodId = req.params.foodId;
        const { userEmail } = req.body;

        console.log("❤️ Like request received:", { foodId, userEmail });

        // Validate foodId
        if (!ObjectId.isValid(foodId)) {
          return res.status(400).send({
            success: false,
            message: "Invalid food ID",
          });
        }

        // Validate userEmail
        if (!userEmail) {
          return res.status(400).send({
            success: false,
            message: "userEmail is required in request body",
          });
        }

        const filter = { _id: new ObjectId(foodId) };
        const food = await foodsCollection.findOne(filter);

        if (!food) {
          return res.status(404).send({
            success: false,
            message: "Food not found",
          });
        }

        // Check if user already liked this food
        const alreadyLiked = food.likedBy && food.likedBy.includes(userEmail);

        let updateDoc;
        let message;
        let liked;

        if (alreadyLiked) {
          // Unlike: remove user from likedBy array
          updateDoc = {
            $pull: { likedBy: userEmail },
          };
          message = "Dislike Successful";
          liked = false;
        } else {
          // Like: add user to likedBy array
          updateDoc = {
            $addToSet: { likedBy: userEmail },
          };
          message = "Like Successful";
          liked = true;
        }

        const result = await foodsCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount === 0) {
          return res.status(400).send({
            success: false,
            message: "No changes made",
          });
        }

        console.log("❤️ Like operation completed:", {
          foodTitle: food.foodTitle,
          userEmail: userEmail,
          action: alreadyLiked ? "unlike" : "like",
          modifiedCount: result.modifiedCount,
        });

        // Create notification only if someone else likes the food owner's post
        if (!alreadyLiked && food.userEmail !== userEmail) {
          await createNotification({
            userEmail: food.userEmail,
            type: "food_liked",
            message: `❤️ ${userEmail} liked your "${food.foodTitle}"`,
            foodId: foodId,
            foodTitle: food.foodTitle,
            relatedUser: userEmail,
          });
          console.log("📢 Like notification created for food owner");
        }

        // Get updated food to return current likes count
        const updatedFood = await foodsCollection.findOne(filter);
        const likesCount = updatedFood.likedBy ? updatedFood.likedBy.length : 0;

        res.send({
          success: true,
          message: message,
          liked: liked,
          likesCount: likesCount,
          foodId: foodId,
        });
      } catch (error) {
        console.error("❌ Error in like operation:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error",
          error: error.message,
        });
      }
    });

    // Review API with notification
    app.post("/review", async (req, res) => {
      try {
        const review = req.body;
        const { userEmail } = req.body;

        if (!userEmail) {
          return res.status(400).send({ message: "userEmail is required" });
        }

        const foodItem = await foodsCollection.findOne({
          foodTitle: review.foodItem,
          userEmail: userEmail,
        });

        if (!foodItem) {
          return res
            .status(403)
            .send({ message: "You can only add notes to items you added" });
        }

        review.userEmail = userEmail;
        review.postedDate = new Date().toISOString();

        const result = await reviewCollection.insertOne(review);

        // Create notification for review
        await createNotification({
          userEmail: userEmail,
          type: "review_added",
          message: `📝 You added a review for "${review.foodItem}"`,
          foodId: foodItem._id.toString(),
          foodTitle: review.foodItem,
          relatedUser: userEmail,
        });

        res.send({
          success: true,
          message: "Review added successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/review", async (req, res) => {
      try {
        const { foodItem } = req.query;
        const query = {};

        if (foodItem) {
          query.foodItem = foodItem;
        }

        const result = await reviewCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Notifications API - No token verification
    app.get('/notifications', async (req, res) => {
      try {
        const { userEmail } = req.query;
        console.log('📧 Fetching notifications for:', userEmail);

        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const result = await notificationsCollection
          .find({ userEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();
        
        console.log(`✅ Found ${result.length} notifications for ${userEmail}`);
        res.send(result);
      } catch (error) {
        console.error('❌ Error fetching notifications:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    app.get('/notifications/count', async (req, res) => {
      try {
        const { userEmail } = req.query;
        console.log('📊 Counting notifications for:', userEmail);

        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const count = await notificationsCollection.countDocuments({
          userEmail: userEmail,
          read: false
        });
        
        console.log(`✅ Unread count for ${userEmail}: ${count}`);
        res.send({ count });
      } catch (error) {
        console.error('❌ Error counting notifications:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    app.put('/notifications/mark-read', async (req, res) => {
      try {
        const { userEmail } = req.body;
        console.log('📝 Marking all as read for:', userEmail);

        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const result = await notificationsCollection.updateMany(
          { userEmail: userEmail, read: false },
          { $set: { read: true } }
        );
        
        console.log(`✅ Marked ${result.modifiedCount} as read`);
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error('❌ Error marking as read:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    app.put('/notifications/:id/read', async (req, res) => {
      try {
        const id = req.params.id;
        const { userEmail } = req.body;
        
        console.log('📝 Marking notification as read:', { id, userEmail });

        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const result = await notificationsCollection.updateOne(
          { _id: new ObjectId(id), userEmail: userEmail },
          { $set: { read: true } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: 'Notification not found' });
        }

        res.send({ success: true });
      } catch (error) {
        console.error('❌ Error marking notification as read:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    app.delete('/notifications/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { userEmail } = req.body;
        
        console.log('🗑️ Deleting notification:', { id, userEmail });

        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const result = await notificationsCollection.deleteOne({
          _id: new ObjectId(id),
          userEmail: userEmail
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Notification not found' });
        }

        res.send({ success: true, message: 'Notification deleted' });
      } catch (error) {
        console.error('❌ Error deleting notification:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    app.delete('/notifications', async (req, res) => {
      try {
        const { userEmail } = req.body;
        console.log('🗑️ Deleting all notifications for:', userEmail);

        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const result = await notificationsCollection.deleteMany({
          userEmail: userEmail
        });
        
        console.log(`✅ Deleted ${result.deletedCount} notifications`);
        res.send({ 
          success: true, 
          message: 'All notifications deleted',
          deletedCount: result.deletedCount 
        });
      } catch (error) {
        console.error('❌ Error deleting all notifications:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    // Test endpoint to create notifications
    app.post('/notifications/test', async (req, res) => {
      try {
        const { userEmail } = req.body;
        
        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const testNotifications = [
          {
            userEmail: userEmail,
            type: 'food_added',
            message: 'Test notification 1 - You added "Apple" to your fridge',
            read: false,
            createdAt: new Date().toISOString()
          },
          {
            userEmail: userEmail,
            type: 'food_liked', 
            message: 'Test notification 2 - John liked your "Banana"',
            read: false,
            createdAt: new Date().toISOString()
          },
          {
            userEmail: userEmail,
            type: 'expiry_soon',
            message: 'Test notification 3 - "Milk" expires in 2 days',
            read: false,
            createdAt: new Date().toISOString()
          }
        ];

        const result = await notificationsCollection.insertMany(testNotifications);
        res.send({ success: true, insertedCount: result.insertedCount });
      } catch (error) {
        console.error('Error creating test notifications:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    // Run initial check on server start
    console.log("🚀 Starting initial expiry check...");
    await createExpiryNotifications();

    // Run notification check every hour
    setInterval(createExpiryNotifications, 60 * 60 * 1000);
    
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Food Tracker Server is running!");
});

app.listen(port, () => {
  console.log(`Food Tracker app listening on port ${port}`);
});