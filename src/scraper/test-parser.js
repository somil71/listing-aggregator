const { MessageParser } = require('./message-parser');

const parser = new MessageParser();

const testMessages = [
  "🏠 LUXURY 3BHK IN BANDRA ₹2.5 Cr | 1500 sqft | 3BR/2BA Parking | Furnished Raj Patel - 9876543210",
  "Villa in Powai, 4BHK, 2500 sqft, ₹5 Crore, unfurnished, direct owner. Call Priya - 8765432109",
  "Plot in Thane, 5000 sqft, ₹80 Lakh, corner plot, ready for construction. Amit Verma - 7654321098",
  "2BHK apartment in Andheri, 950 sqft, ₹1.2 Crore, furnished, 1 parking. Contact - 9123456789",
  "Commercial shop in Dadar, 800 sqft, ₹2.5 Cr, prime location. No parking. Suresh - 8901234567"
];

console.log("Testing Message Parser...\n");

testMessages.forEach((msg, index) => {
  const result = parser.parse(msg, "Agent Name");
  console.log(`Message ${index + 1}:`);
  console.log(`Text: ${msg.substring(0, 60)}...`);
  console.log(`Parsed:`, JSON.stringify(result, null, 2));
  console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log("---\n");
});
