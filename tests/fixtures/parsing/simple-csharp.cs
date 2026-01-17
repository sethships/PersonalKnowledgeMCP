/**
 * C# test fixture for Roslyn parser testing.
 *
 * This file demonstrates various C# constructs for parser validation.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

// Aliased using
using Path = System.IO.Path;
using Console = System.Console;

// Static using
using static System.Math;

// Global using (C# 10+)
// global using System.Collections.Generic;

namespace ParserTests
{
    /// <summary>
    /// A simple public class demonstrating basic class structure.
    /// </summary>
    public class SimpleClass
    {
        /// <summary>
        /// A public property with getter and setter.
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// A read-only property.
        /// </summary>
        public int Id { get; }

        /// <summary>
        /// A private field.
        /// </summary>
        private readonly List<string> _items;

        /// <summary>
        /// Constructor for SimpleClass.
        /// </summary>
        /// <param name="id">The unique identifier.</param>
        /// <param name="name">The name.</param>
        public SimpleClass(int id, string name)
        {
            Id = id;
            Name = name;
            _items = new List<string>();
        }

        /// <summary>
        /// A public method with parameters.
        /// </summary>
        /// <param name="item">Item to add.</param>
        public void AddItem(string item)
        {
            _items.Add(item);
        }

        /// <summary>
        /// A method with a return type.
        /// </summary>
        /// <returns>The count of items.</returns>
        public int GetCount()
        {
            return _items.Count;
        }

        /// <summary>
        /// A private helper method.
        /// </summary>
        private void InternalProcess()
        {
            Console.WriteLine("Processing...");
        }
    }

    /// <summary>
    /// An interface demonstrating interface structure.
    /// </summary>
    public interface IProcessor
    {
        /// <summary>
        /// Processes data asynchronously.
        /// </summary>
        /// <param name="data">The data to process.</param>
        /// <returns>The processed result.</returns>
        Task<string> ProcessAsync(string data);

        /// <summary>
        /// Gets the processor name.
        /// </summary>
        string Name { get; }

        /// <summary>
        /// Resets the processor.
        /// </summary>
        void Reset();
    }

    /// <summary>
    /// A class implementing an interface.
    /// </summary>
    public class DataProcessor : IProcessor
    {
        public string Name => "DataProcessor";

        public async Task<string> ProcessAsync(string data)
        {
            await Task.Delay(100);
            return data.ToUpper();
        }

        public void Reset()
        {
            // Reset logic
        }
    }

    /// <summary>
    /// An abstract base class.
    /// </summary>
    public abstract class BaseEntity
    {
        public Guid Id { get; protected set; }

        public abstract void Save();

        public virtual void Load()
        {
            Console.WriteLine("Loading entity...");
        }
    }

    /// <summary>
    /// A class with inheritance.
    /// </summary>
    public class UserEntity : BaseEntity
    {
        public string Username { get; set; }

        public override void Save()
        {
            Console.WriteLine($"Saving user {Username}");
        }

        public override void Load()
        {
            base.Load();
            Console.WriteLine($"Loading user {Username}");
        }
    }

    /// <summary>
    /// A generic class with type constraints.
    /// </summary>
    /// <typeparam name="T">The type of items.</typeparam>
    public class Repository<T> where T : BaseEntity, new()
    {
        private readonly Dictionary<Guid, T> _items = new();

        public void Add(T item)
        {
            _items[item.Id] = item;
        }

        public T? Get(Guid id)
        {
            return _items.TryGetValue(id, out var item) ? item : null;
        }

        public IEnumerable<T> GetAll()
        {
            return _items.Values;
        }
    }

    /// <summary>
    /// A struct demonstrating struct structure.
    /// </summary>
    public struct Point
    {
        public double X { get; set; }
        public double Y { get; set; }

        public Point(double x, double y)
        {
            X = x;
            Y = y;
        }

        public double Distance()
        {
            return Sqrt(X * X + Y * Y);
        }
    }

    /// <summary>
    /// A record demonstrating record structure (C# 9+).
    /// </summary>
    /// <param name="FirstName">The first name.</param>
    /// <param name="LastName">The last name.</param>
    public record Person(string FirstName, string LastName)
    {
        public string FullName => $"{FirstName} {LastName}";
    }

    /// <summary>
    /// An enum demonstrating enum structure.
    /// </summary>
    public enum Status
    {
        Pending = 0,
        Active = 1,
        Completed = 2,
        Cancelled = 3
    }

    /// <summary>
    /// A delegate type.
    /// </summary>
    /// <param name="message">The message to handle.</param>
    /// <returns>True if handled successfully.</returns>
    public delegate bool MessageHandler(string message);

    /// <summary>
    /// A static class with extension methods.
    /// </summary>
    public static class StringExtensions
    {
        /// <summary>
        /// Truncates a string to the specified length.
        /// </summary>
        /// <param name="str">The string to truncate.</param>
        /// <param name="maxLength">Maximum length.</param>
        /// <returns>The truncated string.</returns>
        public static string Truncate(this string str, int maxLength)
        {
            if (string.IsNullOrEmpty(str))
                return str;

            return str.Length <= maxLength ? str : str.Substring(0, maxLength) + "...";
        }
    }

    /// <summary>
    /// An internal class.
    /// </summary>
    internal class InternalHelper
    {
        public void DoWork()
        {
            Console.WriteLine("Internal work");
        }
    }

    /// <summary>
    /// A class demonstrating various method signatures and calls.
    /// </summary>
    public class MethodExamples
    {
        /// <summary>
        /// A method with optional parameters.
        /// </summary>
        /// <param name="required">Required parameter.</param>
        /// <param name="optional">Optional parameter with default.</param>
        /// <param name="another">Another optional parameter.</param>
        public void MethodWithOptionalParams(string required, int optional = 10, string another = "default")
        {
            Console.WriteLine($"{required}, {optional}, {another}");
        }

        /// <summary>
        /// A method with params array.
        /// </summary>
        /// <param name="items">Variable number of items.</param>
        public void MethodWithParams(params string[] items)
        {
            foreach (var item in items)
            {
                Console.WriteLine(item);
            }
        }

        /// <summary>
        /// A method with out parameter.
        /// </summary>
        /// <param name="input">Input value.</param>
        /// <param name="result">Output result.</param>
        /// <returns>Success status.</returns>
        public bool TryParse(string input, out int result)
        {
            return int.TryParse(input, out result);
        }

        /// <summary>
        /// A method with ref parameter.
        /// </summary>
        /// <param name="value">Value to modify.</param>
        public void ModifyValue(ref int value)
        {
            value *= 2;
        }

        /// <summary>
        /// An async method with await.
        /// </summary>
        /// <param name="url">URL to fetch.</param>
        /// <returns>The response.</returns>
        public async Task<string> FetchDataAsync(string url)
        {
            await Task.Delay(100);
            return $"Data from {url}";
        }

        /// <summary>
        /// A method demonstrating various calls.
        /// </summary>
        public async Task DemonstrateCallsAsync()
        {
            // Simple method call
            MethodWithOptionalParams("test");

            // Call with all parameters
            MethodWithOptionalParams("test", 20, "custom");

            // Params call
            MethodWithParams("a", "b", "c");

            // Out parameter call
            if (TryParse("42", out var number))
            {
                Console.WriteLine(number);
            }

            // Object creation
            var simple = new SimpleClass(1, "Test");
            simple.AddItem("item1");

            // Method chaining
            var count = simple.GetCount();

            // Static method call
            var sqrt = Sqrt(16);

            // Extension method call
            var truncated = "Hello World".Truncate(5);

            // Async call
            var data = await FetchDataAsync("https://example.com");

            // LINQ method calls
            var items = new List<int> { 1, 2, 3, 4, 5 };
            var filtered = items.Where(x => x > 2).Select(x => x * 2).ToList();

            // Generic method call
            var repo = new Repository<UserEntity>();
            repo.Add(new UserEntity { Username = "test" });
        }
    }

    /// <summary>
    /// A sealed class.
    /// </summary>
    public sealed class FinalClass
    {
        public void Execute()
        {
            Console.WriteLine("Executing...");
        }
    }

    /// <summary>
    /// A partial class (part 1).
    /// </summary>
    public partial class PartialExample
    {
        public int Part1Property { get; set; }

        public void Part1Method()
        {
            Console.WriteLine("Part 1");
        }
    }
}
